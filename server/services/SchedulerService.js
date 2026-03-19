/**
 * スケジューラーサービス
 * 
 * @file SchedulerService.js
 * @description 定期的にスクレイピングを実行
 * @version 1.0.1
 * @date 2026-01-27
 */

const cron = require('node-cron');
const scrapingService = require('./ScrapingService');

class SchedulerService {
  constructor() {
    this.jobs = [];
    this.isEnabled = process.env.ENABLE_SCHEDULER === 'true';
    this.interval = process.env.SCRAPING_INTERVAL || '*/15 * * * *';
  }

  start() {
    if (!this.isEnabled) {
      console.log('⚠️  スケジューラーは無効です（ENABLE_SCHEDULER=false）');
      return;
    }

    if (!cron.validate(this.interval)) {
      console.error(`❌ 無効なCron式: ${this.interval}`);
      return;
    }

    const job = cron.schedule(this.interval, async () => {
      const now = new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
      console.log(`\n${'='.repeat(60)}`);
      console.log(`🤖 定期スクレイピング開始 - ${now}`);
      console.log(`${'='.repeat(60)}\n`);

      try {
        const result = await scrapingService.scrapeAllKeywords();

        // ✅ 修正: result が undefined でもクラッシュしない
        if (result?.success) {
          console.log(`\n✅ 定期スクレイピング完了: ${result.totalProducts}件取得`);
        } else if (result) {
          console.log(`\n⚠️  定期スクレイピング: ${result.message || '一部失敗'}`);
        } else {
          console.log(`\n⚠️  定期スクレイピング: 結果が取得できませんでした`);
        }
      } catch (error) {
        console.error('\n❌ 定期スクレイピングエラー:', error.message);
        console.error('スタックトレース:', error.stack);
      }

      console.log(`\n${'='.repeat(60)}`);
      console.log(`⏰ 次回実行予定: ${this.getNextExecutionTime()}`);
      console.log(`${'='.repeat(60)}\n`);
    });

    this.jobs.push(job);

    console.log('✅ スケジューラー起動完了');
    console.log(`📅 実行間隔: ${this.interval}`);
    console.log(`⏰ 次回実行予定: ${this.getNextExecutionTime()}`);
    this.logIntervalDescription();
  }

  stop() {
    if (this.jobs.length === 0) {
      console.log('⚠️  停止するジョブがありません');
      return;
    }

    this.jobs.forEach(job => job.stop());
    this.jobs = [];
    console.log('⏹️  スケジューラー停止');
  }

  getNextExecutionTime() {
    const now = new Date();
    const parts = this.interval.split(' ');
    const minutes = parts[0];

    if (minutes.startsWith('*/')) {
      const interval = parseInt(minutes.substring(2));
      const nextMinutes = Math.ceil(now.getMinutes() / interval) * interval;
      const nextTime = new Date(now);

      if (nextMinutes >= 60) {
        nextTime.setHours(nextTime.getHours() + 1);
        nextTime.setMinutes(0);
      } else {
        nextTime.setMinutes(nextMinutes);
      }

      nextTime.setSeconds(0);
      return nextTime.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
    }

    return '計算中...';
  }

  logIntervalDescription() {
    const descriptions = {
      '*/15 * * * *': '15分ごと（毎時 0, 15, 30, 45分）',
      '*/30 * * * *': '30分ごと（毎時 0, 30分）',
      '0 * * * *': '1時間ごと（毎時0分）',
      '0 */2 * * *': '2時間ごと（0時、2時、4時...）',
      '0 */6 * * *': '6時間ごと（0時、6時、12時、18時）',
      '0 9 * * *': '毎日午前9時',
      '0 9,18 * * *': '毎日午前9時と午後6時',
      '0 9 * * 1-5': '平日の午前9時'
    };

    const description = descriptions[this.interval];
    if (description) {
      console.log(`📝 実行パターン: ${description}`);
    }
  }

  getStatus() {
    return {
      enabled: this.isEnabled,
      interval: this.interval,
      activeJobs: this.jobs.length,
      nextExecution: this.getNextExecutionTime()
    };
  }
}

module.exports = new SchedulerService();
