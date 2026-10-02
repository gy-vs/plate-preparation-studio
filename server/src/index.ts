import { existsSync } from 'node:fs';
import express from 'express';
import { join } from 'node:path';
import { createApp } from './app.js';
import { PlanStore } from './core/store.js';

const port = Number(process.env.PORT ?? 3001);
const dataDir = process.env.DATA_DIR ?? join(process.cwd(), 'data');
const store = new PlanStore(dataDir);
const app = createApp(store);

// 生产模式：直接托管前端构建产物，单进程即可运行。
const webDist = join(process.cwd(), '..', 'web', 'dist');
if (existsSync(webDist)) {
  app.use(express.static(webDist));
  app.get('*', (_req, res) => res.sendFile(join(webDist, 'index.html')));
}

app.listen(port, () => {
  console.log(`板实验配液服务已启动：http://localhost:${port}（数据目录 ${dataDir}）`);
});
