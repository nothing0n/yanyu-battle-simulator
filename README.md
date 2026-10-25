# 烟雨江湖演武台

战斗模拟器静态网站。

网站地址：https://nothing0n.github.io/yanyu-battle-simulator/

## 发布方式

本仓库保存 GitHub Pages 工作流。网页及运行资源打包为 `site.tar.gz`，作为 GitHub Release 附件上传。网站和 Release 附件公开访问。

1. 在本地项目根目录执行 `tar -czf site.tar.gz -C dist .`。压缩包根目录必须直接包含 `index.html`。
2. 创建新 Release，目标为 `main`，上传 `site.tar.gz` 并等待上传完成，再发布 Release。
3. 打开 Actions → Deploy to GitHub Pages → Run workflow，选择 `main`，填写 Release 标签，留空使用最新 Release。启动后自动下载、解压并部署。

Pages 发布源设为 GitHub Actions。`github-pages` 环境保留仅允许 `main` 部署的规则。仓库不包含本地研究文件、运行日志或个人配置。
