# Analytics Engine 数据分析配置

## 概述
为 Memoraid 后端配置了 Cloudflare Analytics Engine,用于收集和分析用户行为数据、系统使用情况等关键指标。

## 配置文件

### wrangler.jsonc
```jsonc
{
  "analytics_engine_datasets": [
    { "binding": "Memoraid", "dataset": "Memoraid" }
  ]
}
```

### 作用说明
- **wrangler.toml**: 主配置文件,定义 Worker 基本信息和资源绑定(D1数据库、R2存储)
- **wrangler.jsonc**: 扩展配置文件,用于配置 Analytics Engine 等高级功能
- 部署时 Wrangler 会自动合并这两个配置文件

## 代码修改

### 1. 添加 Analytics Engine 类型定义
在 `backend/src/index.ts` 的 Env 接口中添加:
```typescript
export interface Env {
  DB: D1Database;
  R2: R2Bucket;
  // ... 其他配置
  Memoraid: AnalyticsEngineDataset; // Analytics Engine 数据集绑定
}
```

### 2. 文章发布统计
在文章上报成功后记录数据点:
```typescript
// 位置: /api/articles/report API
env.Memoraid.writeDataPoint({
    indexes: [userId, platform], // 用户ID和平台名称作为索引
    blobs: [
        `article_count:${newArticlesCount}`,
        `total_articles:${articles.length}`,
        `account:${account.id}`
    ],
    doubles: [newArticlesCount] // 新文章数量
});
```

### 3. 用户登录统计
在用户登录成功后记录数据点:
```typescript
// 位置: /auth/login/password API
env.Memoraid.writeDataPoint({
    indexes: [user.id, 'login', 'password'], // 用户ID、事件类型、登录方式
    blobs: [`email:${user.email}`],
    doubles: [1] // 登录次数计数
});
```

### 4. 充值审批统计
在充值审批通过后记录数据点:
```typescript
// 位置: /api/payment/approve API
env.Memoraid.writeDataPoint({
    indexes: [order.user_id, 'payment', 'approved'], // 用户ID、事件类型、审批结果
    blobs: [
        `order_id:${orderId}`,
        `amount:${order.amount}`,
        `quota:${order.quota_amount}`
    ],
    doubles: [order.amount, order.quota_amount] // 金额和额度数量
});
```

## Analytics Engine 数据结构

### writeDataPoint 参数说明
- **indexes**: 索引字段(最多20个),用于查询和聚合,支持字符串类型
- **blobs**: 文本字段(最多20个),用于存储额外信息,支持字符串类型
- **doubles**: 数值字段(最多20个),用于数值计算和统计,支持双精度浮点数

### 数据点示例
```typescript
{
    indexes: ['user_123', 'weixin'],  // 用户ID、平台
    blobs: ['article_count:5'],        // 文章数量
    doubles: [5],                      // 数值统计
    timestamp: 1709712000              // 自动添加时间戳
}
```

## 查看分析数据

### Cloudflare Dashboard
1. 登录 Cloudflare Dashboard
2. 进入 Workers & Pages
3. 选择 memoraid-backend
4. 点击 Analytics Engine 标签
5. 查看数据图表和统计报告

### GraphQL API 查询
可以使用 Cloudflare GraphQL API 查询 Analytics 数据:
```graphql
query {
  viewer {
    accounts(filter: {accountTag: "your-account-id"}) {
      analyticsEngineDatasets(filter: {name: "Memoraid"}) {
        # 查询数据点
      }
    }
  }
}
```

## 使用场景

### 1. 文章发布分析
- 统计每个用户的文章发布数量
- 分析不同平台的使用情况
- 追踪文章发布趋势

### 2. 用户行为分析
- 统计用户登录频率
- 分析活跃用户数量
- 追踪用户留存率

### 3. 收入分析
- 统计充值金额和频率
- 分析付费用户转化率
- 追踪收入趋势

### 4. 系统性能监控
- 追踪 API 响应时间
- 监控错误率
- 分析系统负载

## 注意事项

1. **数据保留期**: Analytics Engine 数据默认保留 90 天
2. **写入限制**: 每个请求最多写入 25 个数据点
3. **查询限制**: GraphQL API 有速率限制
4. **成本**: Analytics Engine 按写入的数据点数量计费
5. **错误处理**: Analytics 写入失败不应影响主业务流程

## 部署信息
- 部署版本: a3cb2816-6e61-4bcb-8708-e0597cc46bcb
- 部署时间: 2026-03-06 12:18
- 后端URL: https://memoraid-backend.iuyuger.workers.dev

## 后续优化建议

1. 添加更多关键事件的数据点记录(如文章生成、API调用等)
2. 创建自定义 Dashboard 展示关键指标
3. 设置告警规则,监控异常情况
4. 定期分析数据,优化产品功能
5. 结合 D1 数据库数据进行深度分析
