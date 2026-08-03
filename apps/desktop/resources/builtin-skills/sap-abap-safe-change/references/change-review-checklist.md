# ABAP 运维变更质量门禁

## 身份、基线与追溯

- Requirement/Technical Design、SID、Client、ABAP 版本和对象范围唯一明确。
- 当前版本、Include/类/函数/增强和 DDIC/CDS 依赖齐全；记录读取时间和回退基线。
- 每个改动对应需求、测试用例、Transport/Release 和 owner。

## 正确性与数据

- Key、排序、去重、聚合、空值、前导零、三态字段、时区。
- 单位、价格单位、币种、小数、正负、冲销/退货和历史数据。
- 锁、LUW、COMMIT/ROLLBACK、更新任务、幂等、并发和部分失败。
- 消息、异常、日志、重试和外部接口副作用。

## 性能、安全与兼容

- 循环内 SELECT、全表扫描、空 `FOR ALL ENTRIES`、内表复杂度和重复远程调用。
- `AUTHORITY-CHECK`、动态 SQL、文件/RFC/HTTP、敏感字段与日志脱敏。
- 目标 ABAP 版本、released API、Unicode、数据库和既有调用者兼容。

## 验证记录

| 门禁 | 结果（通过/失败/未执行） | 工具/variant | 证据 | owner |
|---|---|---|---|---|
| 语法/激活 |  |  |  |  |
| ATC |  |  |  |  |
| ABAP Unit |  |  |  |  |
| Peer review / four-eyes |  |  |  |  |
| 功能/集成/回归 |  |  |  |  |

Clean ABAP、reviewer 数量、ATC variant 和豁免以客户正式规则为准；SAP/styleguides 是官方维护的可选指南，不自动视为强制。
