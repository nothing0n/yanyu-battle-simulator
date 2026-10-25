# 烟雨江湖演武台

战斗模拟器静态网站。

网站地址：https://nothing0n.github.io/yanyu-battle-simulator/

## 发布方式

本仓库保存 GitHub Pages 工作流。网页及运行资源打包为 `site.tar.gz`，随 GitHub Release 发布，工作流自动下载、解压并部署。网站和 Release 附件公开访问。

1. 在本地项目根目录执行 `tar -czf site.tar.gz -C dist .`。压缩包根目录必须直接包含 `index.html`。
2. 创建新 Release，目标为 `main`，上传 `site.tar.gz` 并等待上传完成，再发布 Release。
3. 在 Actions 中查看 `Deploy to GitHub Pages`。也可以从 `main` 手动运行，填写需要部署的 Release 标签，留空使用最新 Release。

Pages 发布源设为 GitHub Actions。仓库不包含本地研究文件、运行日志或个人配置。
