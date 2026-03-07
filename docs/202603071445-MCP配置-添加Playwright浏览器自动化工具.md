# MCP 配置 - Playwright 浏览器自动化工具

## 配置内容
为 Kiro 添加了 Playwright MCP Server，用于浏览器自动化操作。

## 配置文件位置
`C:\Users\ralph\.kiro\settings\mcp.json`

## 配置内容
```json
{
  "mcpServers": {
    "playwright": {
      "command": "uvx",
      "args": ["mcp-server-playwright"],
      "env": {
        "FASTMCP_LOG_LEVEL": "ERROR"
      },
      "disabled": false,
      "autoApprove": []
    }
  }
}
```

## Playwright 功能
安装后可以使用以下功能：

### 1. 浏览器操作
- 打开浏览器并访问指定 URL
- 支持 Chromium、Firefox、WebKit
- 可以使用已有的用户数据目录（保持登录状态）

### 2. 页面交互
- 点击元素：`playwright_click`
- 输入文本：`playwright_fill`
- 获取文本内容：`playwright_evaluate`
- 截图：`playwright_screenshot`
- 等待元素：`playwright_wait_for_selector`

### 3. 页面信息获取
- 获取页面 HTML
- 获取元素属性
- 执行 JavaScript 代码
- 获取网络请求

### 4. 高级功能
- 模拟用户操作（滚动、悬停等）
- 处理弹窗和对话框
- 文件上传下载
- Cookie 管理

## 使用方式

### 激活后可用的工具
MCP Server 启动后，会提供一系列 Playwright 工具，例如：
- `playwright_navigate` - 导航到 URL
- `playwright_click` - 点击元素
- `playwright_screenshot` - 截图
- `playwright_evaluate` - 执行 JavaScript
- 等等...

### 示例场景
1. **调试知乎页面**
   - 打开知乎编辑器页面
   - 检查页面元素结构
   - 查看 Markdown 解析后的 DOM 变化
   - 验证图片占位符的位置

2. **自动化测试**
   - 模拟用户发布文章流程
   - 验证图片插入位置
   - 检查发布后的状态

3. **页面信息提取**
   - 获取页面内容
   - 提取特定元素
   - 分析页面结构

## 下一步
1. 重启 Kiro 或在 MCP Server 视图中重新连接
2. 查看 MCP 日志确认 Playwright 服务器已启动
3. 使用 Playwright 工具进行浏览器操作

## 注意事项
1. 首次使用时，`uvx` 会自动下载并安装 `mcp-server-playwright`
2. Playwright 会自动下载浏览器二进制文件（约 300MB）
3. 可以在 `autoApprove` 数组中添加工具名称来自动批准某些操作
4. 如果需要使用已登录的浏览器状态，可以配置 `user-data-dir` 参数

## 相关文档
- Playwright 官方文档：https://playwright.dev/
- MCP Playwright Server：https://github.com/executeautomation/mcp-playwright
