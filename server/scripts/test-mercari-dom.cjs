'use strict';

const puppeteerExtra = require('puppeteer-extra');
const StealthPlugin  = require('puppeteer-extra-plugin-stealth');
puppeteerExtra.use(StealthPlugin());

const KEYWORD = process.argv[2] || 'さかな暮らし';

(async () => {
  let browser = null;
  try {
    browser = await puppeteerExtra.launch({
      headless: 'new',
      protocolTimeout: 30000,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--single-process',
        '--window-size=1366,768',
        '--lang=ja-JP,ja',
      ],
      defaultViewport: { width: 1366, height: 768 },
    });

    const page = await browser.newPage();
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
    );
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'ja-JP,ja;q=0.9,en-US;q=0.8,en;q=0.7',
    });

    const params = new URLSearchParams({ keyword: KEYWORD });
    params.set('sort', 'created_time');
    params.set('order', 'desc');
    params.set('status', 'on_sale');
    const url = `https://jp.mercari.com/search?${params.toString()}`;
    console.log(`\n=== URL: ${url} ===\n`);

    // --- Phase 1: domcontentloaded (現行と同じ) ---
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    console.log('--- Phase 1: domcontentloaded 直後 ---');
    let counts = await page.evaluate(() => ({
      itemCell:       document.querySelectorAll('[data-testid="item-cell"]').length,
      merThumbnail:   document.querySelectorAll('mer-item-thumbnail').length,
      linkToItem:     document.querySelectorAll('a[href*="/item/m"]').length,
    }));
    console.log('セレクタ counts:', JSON.stringify(counts));

    // --- Phase 2: 5秒待機後 ---
    await new Promise(r => setTimeout(r, 5000));
    console.log('\n--- Phase 2: +5秒待機後 ---');
    counts = await page.evaluate(() => ({
      itemCell:       document.querySelectorAll('[data-testid="item-cell"]').length,
      merThumbnail:   document.querySelectorAll('mer-item-thumbnail').length,
      linkToItem:     document.querySelectorAll('a[href*="/item/m"]').length,
    }));
    console.log('セレクタ counts:', JSON.stringify(counts));

    // --- Phase 3: networkidle0 待機 ---
    console.log('\n--- Phase 3: networkidle0 待機中... ---');
    try {
      await page.waitForNetworkIdle({ idleTime: 2000, timeout: 30000 });
      console.log('networkidle0 到達');
    } catch (e) {
      console.log('networkidle0 タイムアウト (30秒)');
    }
    counts = await page.evaluate(() => ({
      itemCell:       document.querySelectorAll('[data-testid="item-cell"]').length,
      merThumbnail:   document.querySelectorAll('mer-item-thumbnail').length,
      linkToItem:     document.querySelectorAll('a[href*="/item/m"]').length,
    }));
    console.log('セレクタ counts:', JSON.stringify(counts));

    // --- Phase 4: さらに10秒待機 ---
    await new Promise(r => setTimeout(r, 10000));
    console.log('\n--- Phase 4: +10秒追加待機後 ---');
    counts = await page.evaluate(() => ({
      itemCell:       document.querySelectorAll('[data-testid="item-cell"]').length,
      merThumbnail:   document.querySelectorAll('mer-item-thumbnail').length,
      linkToItem:     document.querySelectorAll('a[href*="/item/m"]').length,
    }));
    console.log('セレクタ counts:', JSON.stringify(counts));

    // --- DOM構造調査 ---
    console.log('\n=== DOM構造調査 ===');

    const domInfo = await page.evaluate(() => {
      const result = {};

      // 1. 商品リストのコンテナを探す
      const searchResultArea = document.querySelector('#search-result, [data-testid="search-result"], [class*="SearchResult"], [class*="search-result"], [class*="itemList"], [class*="ItemList"]');
      result.searchResultContainer = searchResultArea
        ? { tag: searchResultArea.tagName, id: searchResultArea.id, class: searchResultArea.className?.toString()?.slice(0, 200), childCount: searchResultArea.children.length }
        : null;

      // 2. 全 data-testid 属性の一覧
      const testIds = new Set();
      document.querySelectorAll('[data-testid]').forEach(el => testIds.add(el.getAttribute('data-testid')));
      result.allTestIds = [...testIds].sort();

      // 3. mer-* カスタム要素の一覧
      const merTags = new Set();
      document.querySelectorAll('*').forEach(el => {
        if (el.tagName.toLowerCase().startsWith('mer-')) merTags.add(el.tagName.toLowerCase());
      });
      result.merCustomElements = [...merTags].sort();

      // 4. a[href*="/item/"] の実際のリンク構造
      const itemLinks = document.querySelectorAll('a[href*="/item/"]');
      result.itemLinkCount = itemLinks.length;
      if (itemLinks.length > 0) {
        const first = itemLinks[0];
        const parent = first.parentElement;
        result.firstItemLink = {
          href: first.href,
          className: first.className?.toString()?.slice(0, 200),
          innerHTML: first.innerHTML?.slice(0, 500),
          parentTag: parent?.tagName,
          parentClass: parent?.className?.toString()?.slice(0, 200),
        };
      }

      // 5. スケルトン要素の検出
      const skeletons = document.querySelectorAll('[class*="skeleton" i], [class*="Skeleton" i], [class*="shimmer" i], [class*="placeholder" i], [aria-busy="true"]');
      result.skeletonCount = skeletons.length;
      if (skeletons.length > 0) {
        result.firstSkeleton = {
          tag: skeletons[0].tagName,
          class: skeletons[0].className?.toString()?.slice(0, 200),
        };
      }

      // 6. メイン検索結果エリアの直接の子要素構造
      // h2 "検索結果" の次の兄弟要素を探す
      const h2s = document.querySelectorAll('h2');
      for (const h2 of h2s) {
        if (h2.textContent.includes('検索結果')) {
          result.searchResultH2 = h2.textContent.trim();
          const next = h2.nextElementSibling;
          if (next) {
            result.afterH2 = {
              tag: next.tagName,
              class: next.className?.toString()?.slice(0, 200),
              childCount: next.children.length,
              firstChildTag: next.children[0]?.tagName,
              firstChildClass: next.children[0]?.className?.toString()?.slice(0, 200),
            };
          }
        }
      }

      // 7. 商品グリッド/リスト周辺のHTML構造 (商品一覧の外枠)
      // ul/ol内のli > a[href*="/item/"] パターンを探す
      const listItems = document.querySelectorAll('li a[href*="/item/"]');
      result.liItemLinkCount = listItems.length;

      // 8. div[class] の中で商品カード的なもの
      const possibleCards = document.querySelectorAll('div[class*="item" i], div[class*="card" i], div[class*="product" i]');
      result.possibleCardSelectors = {};
      possibleCards.forEach(el => {
        const cls = el.className?.toString()?.slice(0, 100);
        result.possibleCardSelectors[cls] = (result.possibleCardSelectors[cls] || 0) + 1;
      });

      // 9. ページの main/section 構造
      const mainContent = document.querySelector('main') || document.querySelector('[role="main"]');
      if (mainContent) {
        result.mainHTML = mainContent.innerHTML?.slice(0, 3000);
      }

      return result;
    });

    console.log('\n--- data-testid 一覧 ---');
    console.log(domInfo.allTestIds);

    console.log('\n--- mer-* カスタム要素 ---');
    console.log(domInfo.merCustomElements);

    console.log('\n--- 検索結果コンテナ ---');
    console.log(JSON.stringify(domInfo.searchResultContainer, null, 2));

    console.log('\n--- item link count ---');
    console.log(domInfo.itemLinkCount);

    console.log('\n--- 最初のitemリンク ---');
    console.log(JSON.stringify(domInfo.firstItemLink, null, 2));

    console.log('\n--- スケルトン要素 ---');
    console.log(`count: ${domInfo.skeletonCount}`);
    console.log(JSON.stringify(domInfo.firstSkeleton, null, 2));

    console.log('\n--- li > a[href*="/item/"] ---');
    console.log(`count: ${domInfo.liItemLinkCount}`);

    console.log('\n--- 可能性のあるカードセレクタ ---');
    console.log(JSON.stringify(domInfo.possibleCardSelectors, null, 2));

    console.log('\n--- 検索結果H2周辺 ---');
    console.log(domInfo.searchResultH2);
    console.log(JSON.stringify(domInfo.afterH2, null, 2));

    console.log('\n--- mainコンテンツHTML (先頭3000文字) ---');
    console.log(domInfo.mainHTML?.slice(0, 3000));

    // スクリーンショット (最終状態)
    await page.screenshot({ path: 'server/debug-mercari-dom-test.png', fullPage: false });
    console.log('\n📸 最終スクリーンショット: server/debug-mercari-dom-test.png');

  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    if (browser) {
      try { await browser.close(); } catch (_) {
        try {
          const pid = browser.process()?.pid;
          if (pid) process.kill(pid, 'SIGKILL');
        } catch (_) {}
      }
    }
  }
})();
