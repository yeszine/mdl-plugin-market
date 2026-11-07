# 市场入口开关

平台扩展功能示例，安装模式只有 `toggle`。

- 配置键：`market.entry.enabled`
- 默认：`true`
- 作用域：`user`
- 行为：宿主设置页显示或隐藏插件市场入口；不下载包、不写资产目录。

客户端收到 `capabilities.install.modes = ["toggle"]` 时，应改写宿主配置而不是复制文件。禁用后入口隐藏，但已安装资产不受影响。
