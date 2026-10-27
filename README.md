# 烟雨江湖演武台

战斗模拟器静态网站，使用固定快照的原始 LuaJIT 战斗字节码和网页虚拟机。

网站地址：https://nothing0n.github.io/yanyu-battle-simulator/

## 发布方式

本仓库保存战斗运行层、输入适配、原模块和配置、去标识化回归样例及 GitHub Pages 工作流。大型美术资源继续随 `site.tar.gz` Release 附件分发；未提交个人存档、账号信息或私人战报。网站和 Release 附件公开访问。

1. 在本地项目根目录执行 `tar -czf site.tar.gz -C dist .`。压缩包根目录必须直接包含 `index.html`。
2. 创建新 Release，目标为 `main`，上传 `site.tar.gz` 并等待上传完成，再发布 Release。
3. 打开 Actions → Deploy to GitHub Pages → Run workflow，选择 `main`，填写 Release 标签，留空使用最新 Release。启动后自动下载、解压并部署。

Pages 发布源设为 GitHub Actions。`github-pages` 环境保留仅允许 `main` 部署的规则。仓库不包含本地研究文件、运行日志或个人配置。

## 本地验证

需要 Node.js 20 或更新版本，不需要安装 npm 依赖。

```text
npm test
node tools/compare-inner.mjs --samples 200 --seed 20261027 --jobs 6 --out ./analysis/inner-run
```

第二条命令是公开合成四对四基准，输出逐场结果、输入哈希、Wilson 胜率区间、配对差值区间、输出与生存指标。输出目录必须尚不存在。它衡量固定模型与构造对手下的表现，不代表真实竞技场对手分布或实机胜率。

完整图形界面需要从 Release 解压 `dist/assets/` 到本仓库同路径，再运行 `npm start`。

## 战斗兼容修复

- Lua 表在 `pairs/next` 期间删除当前键后继续遍历；未知游标仍明确报错。
- 归云诀选择单一体态，道心种魔按第四/第五/第六斩选择合法替换招式。
- 本地已解密角色可通过原 `initWithConver` 和原 getter 结算面板，战斗导入保留装备、秘技、精进等动态状态；个人数据只在调用者内存和指定本地输出中处理。

原代码执行与回归通过不等于实机全量一致：原生哈希遍历顺序、当前热更新、完整实机战报对照仍有边界。公开基准会把失败、回合截断与真实结束分别统计，不把报错计成败场。
