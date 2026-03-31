# AGENTS

1. 始终使用中文对话
2. 生成的代码按功能拆分，能复用的功能方法进行复用，不要重复实现相同功能
3. 我把一些关键信息保存在本地环境变量，你可以去查看，需要的时候获取使用，简单的方法是echo 某个变量获取到
4. 使用npx wrangler deploy命令部署后端服务，不会覆盖远程变量，不需要重新配置变量
5. 我让你记住的一些东西，或者经常需要使用的信息，你可以保存在规则文件里，并且进行加密
6. 涉及浏览器页面交互的操作，可以自动调用mcp工具，比如playwright，chrome devtools访问浏览器，查看相关页面了解页面信息
7. 更改完代码一定要执行npm run build确认不报错
8. 我是初学者，代码尽量加注释，尤其每次改动要加注释说明下
9. 代码仓库地址 https://github.com/ralph-wren/memoraid
10. 所有内容部署到cloudflare page
11. 本地已经安装和cloudflare的d1，r1数据库的交互命令
12. 任务完成后检查下是否符合要求
13. 使用 npx playwright codegen --channel=chrome --user-data-dir="C:\Users\ralph\AppData\Local\Chrome-Automation" https://mp.weixin.qq.com/ 这种命令打开浏览器查看相关页面操作
14. 需要时参考docs\REMOTE_DEBUG.md的调试步骤进行远程调试，需要我在浏览器生成验证码发给你进行调试，现在可以使用~/.kiro/skills/memoraid-remote-debug下的skills调试
15. 生成所有临时文件、测试文件都统一放在跟目录的test目录下，用完删除
16. 每次执行npm run release前，更新一下版本信息
17. 需要遵守.cursor目录下的规则
18. 通过 bash -lc "CI=1 npx wrangler r2 object put pothos-images/memoraid/feature-extract.png --file ../store-assets/feature-extract.png --content-type image/png --remote" 的方式可以上传图片到cloudflare r2
19. https://imgcdn.dpdns.org/作为R2图片的访问域名
20. 生成的说明文档统一放到docs目录,文件名称格式{日期如202601241230}-{功能，几个字}-{具体解决的问题}.md，我让你生成你再生成
21. 每生成一篇文章，都要通过omni-recall skills同步一次记忆到远程数据库,如果skills没有安装，通过`npx skills add ralph-wren/omni-recall`命令进行安装，全局安装不要放在项目下面
22. 测试文件、临时文件统一放到test目录
23. 创建远程数据库表之前先查看有哪些表，别创建相似的表了，不要重复建表
24. skills安装地址在~/.agent/skills或~/.kiro/skills或~/.claude/skills
25. 如果涉及网页操作的代码你不确定或者写不好，可以写一些验证代码我粘贴在控制台测试，能正确执行了你再生成、完善代码
26. 所有关于时间的都是中国时区，默认东八区
27. bash -lc "CI=1 npx wrangler r2 object put pothos-images/memoraid/memoraid-release.zip --file ../release/memoraid-release.zip --content-type application/zip" 通过这个命令把最新版本插件更新到官网