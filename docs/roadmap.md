# Roadmap

> 以下功能不在 V1 版本范围内，供后续版本参考。

## V2: Cloud Storage & Web App

### DynamoDBWriter

实现 ClipWriter 接口，ClipRecord 双写到 DynamoDB。

- Partition key: `id`
- GSI: `platform-createdAt-index`, `category-createdAt-index`
- Tags: String Set 类型

### Web App

独立项目，Lambda + DynamoDB，提供收藏内容的可视化浏览、搜索、筛选。

## V3: Enhanced Features

### Retry Mechanism

Web 后台对 `fetchLevel=4` 的条目手动触发重试。

### Reply Enhancement

龙虾回复包含 Web App 链接，可直接跳转查看。

### Batch Processing

支持一次发送多张截图。

### A2A Protocol Upgrade

从简单 HTTP POST 演进为标准 A2A 协议。
