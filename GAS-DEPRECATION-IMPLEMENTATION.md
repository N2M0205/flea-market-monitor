# GAS廃止・VPS完結化 実装指示書

> 作成日: 2026-04-15
> ブランチ名: `refactor/remove-gas-dependency`
> 目的: GAS同期（2026-03-02以降停止中）への依存を完全に除去し、crossmall-syncですべてのデータをVPS内完結で管理する

-----

## 背景

### 現状の問題

1. `purchase_master_cache.json` の `syncedAt` が `2026-03-02` のまま（GASの最終実行日）
1. GASが担当していた **商品名（item_name）** と **purchaseLimit** の更新が44日間止まっている
1. 550件のSKUが `crossmall_sales_history.json` に履歴はあるが `purchase_master_cache.json` に未登録

### 方針

- **GASは完全廃止**（IP制限でCROSSMALL APIを叩けないため元々機能していなかった）
- **purchaseLimitは不要**（値が未定のため削除してOK）
- **商品名（item_name）** は CROSSMALL API `get_item` で取得してcrossmall-syncに統合
- **syncedAt** はcrossmall-syncの実行日時で更新

-----

## 実装タスク（3つ）

### タスク1: crossmall-sync に商品名取得を追加

#### 概要

`sync-crossmall-prices.cjs` の同期完了後、`get_item` APIで全SKUの商品名を取得して `purchase_master_cache.json` に保存する。

#### CROSSMALL API 仕様: `get_item`

```
URL: https://crossmall.jp/webapi2/get_item?パラメータ
メソッド: HTTP/GET
レスポンス: XML

パラメータ:
  - account: 3663 (必須)
  - item_code: 商品コード (必須)
  - signing: 署名 (必須)

レスポンスに含まれる item_name:
  <item_name>Tシャツ</item_name>
```

#### 実装方針

```javascript
// sync-crossmall-prices.cjs に追加する関数

async function syncItemNames(crossmall) {
  console.log('\n=== 商品名同期 開始 ===');
  
  // purchase_master_cache.json を読み込み
  const cache = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8'));
  
  // item_name が未設定 or 空のSKUだけ対象（毎回全件やると遅いため）
  // ※ 初回は全件取得になる
  const skusNeedingName = Object.entries(cache.items || {})
    .filter(([sku, item]) => !item.item_name || item.item_name === '不明')
    .map(([sku]) => sku);
  
  if (skusNeedingName.length === 0) {
    console.log('商品名更新不要（全SKUに商品名あり）');
    return;
  }
  
  console.log(`商品名未設定: ${skusNeedingName.length}件`);
  
  // item_code は SKU の先頭部分（例: "2314-001811" → item_code は商品マスタのコード）
  // ※ 注意: item_code と SKUの関係を確認すること
  //    CROSSMALLではitem_code（商品コード）+ attribute1_code + attribute2_code = SKU
  //    get_item は item_code 単位で返す
  
  let updated = 0;
  let errors = 0;
  
  for (const sku of skusNeedingName) {
    try {
      // CrossmallService.getItemInfo(sku) のようなメソッドがあるか確認
      // なければ CrossmallService に get_item 呼び出しメソッドを追加
      const itemInfo = await crossmall.getItemInfo(sku);
      
      if (itemInfo && itemInfo.item_name) {
        cache.items[sku].item_name = itemInfo.item_name;
        updated++;
      }
      
      // API制限回避: 1秒待機
      await new Promise(r => setTimeout(r, 1000));
    } catch (err) {
      console.log(`  ⚠️ ${sku}: ${err.message}`);
      errors++;
    }
  }
  
  // 保存
  fs.writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2));
  console.log(`商品名同期完了: ${updated}件更新, ${errors}件エラー`);
}
```

#### 重要な確認ポイント

1. **CrossmallService.js に `get_item` を呼ぶメソッドがあるか確認**
- あればそのまま使う
- なければ `getItemInfo(itemCode)` メソッドを追加する
- 署名生成は既存の `get_stock` / `get_order` と同じロジックでOK
1. **item_code と SKU の関係**
- `purchase_master_cache.json` のキーがSKUコード（例: `2314-001811`）
- `get_item` の `item_code` パラメータに何を渡すべきか
- `crossmall_sales_history.json` 内の注文データに `item_code` フィールドがあるか確認
- もしSKU = item_code ならそのまま渡す
- 属性コードが必要な場合は get_item_sku の方を使う
1. **初回は全157件（キャッシュ登録済み全SKU）が対象**
- 1秒/件 × 157件 = 約3分
- 2回目以降は未設定分のみなので高速
1. **代替案: crossmall_sales_history.json から item_name を取得**
- 注文詳細データに item_name が含まれている場合、APIコール不要
- `crossmall_sales_history.json` の各SKUの `orders` 配列内に `item_name` があるか確認
- あればそこから取得する方が効率的（API不要、即座に実行可能）
- **まずこちらを確認してから API 方式を検討すること**

#### 実行順序（sync-crossmall-prices.cjs の main 関数内）

```javascript
main()
  .then(async () => {
    await syncStock(crossmall);       // 既存: 在庫更新
    await syncItemNames(crossmall);   // 新規: 商品名更新
    await notifyCacheReload();        // 既存: キャッシュリロード
    process.exit(0);
  })
```

-----

### タスク2: syncedAt をcrossmall-sync実行日時で更新

#### 概要

`purchase_master_cache.json` の `syncedAt` をGASのタイムスタンプから、crossmall-syncの実行日時に変更する。

#### 現在の状態

```json
{
  "syncedAt": "2026-03-02T01:16:39.000Z",   // ← GASの最終実行日
  "lastSalePriceSyncedAt": "2026-04-15T03:03:29.871Z",  // ← crossmall-syncの最終実行日
  "items": { ... }
}
```

#### 修正内容

`sync-crossmall-prices.cjs` で `purchase_master_cache.json` を保存する際に `syncedAt` も現在日時で上書きする。

```javascript
// updateLastSalePrices() の中、または save 時に追加
cache.syncedAt = new Date().toISOString();
cache.lastSalePriceSyncedAt = new Date().toISOString();
```

#### 確認ポイント

- `PurchaseMasterCache.js` の `updateCache()` メソッドを確認
- `syncedAt` を参照しているコードが他にあるか grep で確認
- もし `syncedAt` をGAS専用として分けている場合は、フィールド名をそのまま上書きするのが安全

```bash
# syncedAt を参照しているコードを検索
grep -rn "syncedAt" server/
```

-----

### タスク3: GAS関連コードのクリーンアップ

#### 概要

GAS同期に関するコード・設定・コメントを整理する。**削除ではなくコメントアウト or 明示的な「廃止」マーク**で対応（将来の参照用に残す）。

#### 確認・整理対象

```bash
# GAS関連のコード・参照を検索
grep -rn "GAS\|gas\|spreadsheet\|スプレッドシート\|google.sheets\|updateCache" server/
grep -rn "purchaseLimit\|purchase_limit" server/
```

#### 対応方針

1. **`PurchaseMasterCache.js` の `updateCache()` メソッド**
- GASからの呼び出しを想定したメソッド
- コメントで「GAS廃止により未使用。syncedAt は crossmall-sync で更新」と明記
- メソッド自体は削除しない（将来別用途で使う可能性）
1. **purchaseLimit フィールド**
- cache内のデータは残す（参照はしない）
- 利用箇所があれば null/0 チェックを追加
1. **GAS関連ファイル**（もしプロジェクト内にある場合）
- `picofuri_product_master_gas.js`
- `new_ss_setup_guide.md`
- 削除はしない。README等で「廃止」と明記

-----

## テスト手順

### テスト1: syncItemNames の動作確認

```bash
# crossmall-sync を手動実行
cd C:\Users\Administrator\Desktop\flea-market-monitor
node server/scripts/sync-crossmall-prices.cjs
```

確認ポイント:

- `=== 商品名同期 開始 ===` ログが出ること
- 商品名が取得・保存されること
- エラーが出ていないこと

### テスト2: syncedAt の更新確認

```bash
# cache ファイルの syncedAt を確認
node -e "const c = require('./server/data/purchase_master_cache.json'); console.log('syncedAt:', c.syncedAt); console.log('lastSalePriceSyncedAt:', c.lastSalePriceSyncedAt);"
```

確認ポイント:

- `syncedAt` が 2026-03-02 ではなく本日の日時になっていること

### テスト3: cache reload 後のbackend反映確認

```bash
# backendのキャッシュ状態を確認
curl -s http://localhost:3000/api/health
```

### テスト4: LINE通知の商品名確認

- 次回スキャンでLINE通知が届いた際に、商品名が正しく表示されていることを確認

-----

## 実行手順まとめ

1. **まず確認**
- `crossmall_sales_history.json` 内の各SKUに `item_name` フィールドがあるか確認
- `CrossmallService.js` に `get_item` 呼び出しメソッドがあるか確認
- `syncedAt` を参照しているコードを grep で確認
1. **確認結果に基づいて実装方針を報告**
- item_name の取得元: 蓄積データ or API
- syncedAt の更新方法
- GASクリーンアップの影響範囲
1. **オーナー承認後に実装開始**
1. **テスト → git diff master → 承認 → マージ → pm2 restart**

-----

## 注意事項

- mainを直接編集しない。`refactor/remove-gas-dependency` ブランチで作業
- 修正は1つずつテスト。商品名取得 → syncedAt更新 → クリーンアップの順
- API呼び出しは必ず1秒間隔を入れる（CROSSMALL API負荷対策）
- エラー時はスキップして continue（全体を止めない）
- `purchase_master_cache.json` の書き込み前にバックアップを取ること

-----

## 補足: CROSSMALL API `get_item` 仕様

```
エンドポイント: https://crossmall.jp/webapi2/get_item
メソッド: HTTP/GET

パラメータ:
  account    : 3663 (必須)
  item_code  : 商品コード (必須)
  signing    : 署名 (必須)

レスポンス（XML）:
  <GetItem version="1.0">
    <ResultSet TotalResult="1">
      <ResultStatus>
        <GetStatus>success</GetStatus>
      </ResultStatus>
      <Result No="1">
        <item_code>t-shirt</item_code>
        <item_name>Tシャツ</item_name>    ← これが欲しい
        <attribute1_name>カラー</attribute1_name>
        <attribute2_name>サイズ</attribute2_name>
        <unit_price>0</unit_price>
        <notax_purchase_price>0</notax_purchase_price>  ← 仕入原価（将来使える）
        <taxin_purchase_price>0</taxin_purchase_price>
        <cost_price>0</cost_price>
        ...
      </Result>
    </ResultSet>
  </GetItem>
```

署名生成は既存の `get_stock` / `get_order` と同じロジック（CrossmallService.js内の署名関数を流用）。