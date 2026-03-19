require('dotenv').config();
const https = require('https');

console.log('=== LINE設定確認 ===');
console.log('LINE_GROUP_ID:', process.env.LINE_GROUP_ID || '❌ 未設定');
console.log('TOKEN:', process.env.LINE_CHANNEL_ACCESS_TOKEN ? '✅ 設定済み（先頭10文字: ' + process.env.LINE_CHANNEL_ACCESS_TOKEN.substring(0, 10) + '...）' : '❌ 未設定');
console.log('');

const body = JSON.stringify({
  to: process.env.LINE_GROUP_ID,
  messages: [{ type: 'text', text: 'LINE通知テスト' }]
});

const options = {
  hostname: 'api.line.me',
  path: '/v2/bot/message/push',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer ' + process.env.LINE_CHANNEL_ACCESS_TOKEN,
    'Content-Length': Buffer.byteLength(body)
  }
};

const req = https.request(options, function(res) {
  let data = '';
  res.on('data', function(chunk) { data += chunk; });
  res.on('end', function() {
    console.log('=== 結果 ===');
    console.log('STATUS:', res.statusCode);
    console.log('BODY:', data);
    if (res.statusCode === 200) {
      console.log('✅ 成功！LINEに通知が届いているはずです');
    } else if (res.statusCode === 400) {
      console.log('❌ 400エラー: ボットがグループに未招待の可能性が高い');
    } else if (res.statusCode === 401) {
      console.log('❌ 401エラー: トークンが無効 → .envのLINE_CHANNEL_ACCESS_TOKENを確認');
    }
  });
});

req.on('error', function(e) {
  console.error('❌ 接続エラー:', e.message);
});

req.write(body);
req.end();
