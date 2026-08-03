# SAP 库存读取意图与官方只读路径研究

> 研究日期：2026-08-03
> 研究范围：SAP S/4HANA、ABAP Development Tools（ADT）、ABAP Data Preview / SQL Console、库存 CDS 与官方 OData API。
> 来源原则：只采用 SAP Help Portal、SAP 官方配置指南、SAP 官方 API 文档和 ABAP 官方文档。本文不提供可直接复制执行的库存 SQL，也不把未经目标系统验证的表、字段或口径固化为产品规则。

## 1. 结论先行

1. **ADT 确实具备读取业务数据的技术能力，但“T000 读取通过”不足以证明该能力已经可用。** SAP 官方说明，Data Preview 可以读取 ABAP Dictionary 表、View、外部 View 和 ABAP CDS DDL Source，并通过 ABAP SQL 完成筛选、排序和结果集限制；其后端资源由 `/sap/bc/adt/datapreview/*` 控制。当前产品若只验证了 T000 元数据，最多能证明认证和一个固定只读请求成功，仍需单独探测 Data Preview 资源、对象可见性和业务数据授权。[Data Preview](https://help.sap.com/docs/abap-cloud/abap-development-tools-user-guide/data-preview)；[ADT 后端配置指南](https://help.sap.com/doc/2e65ad9a26c84878b1413009f8ac07c3/202510.002/en-US/config_guide_system_backend_abap_development_tools.pdf)
2. **“读取 MB52”首先是业务意图，不应被实现为“直接运行事务”或“猜一张后台表”。** 模型应先识别用户需要的是当前库存、历史时点库存、库存价值、库存移动明细，还是与 MB52 相同的报表口径，再选择经过授权的官方业务 API、Released CDS、受限 Data Preview，或要求用户导出。不能因为 ADT 已连接就声称能自动执行 SAP GUI 事务。
3. **官方首选是业务语义稳定的读取接口，而不是任意 SE16/SQL。** SAP 提供只读 `API_MATERIAL_STOCK`，用于按物料、工厂、库存地点、库存类型和特殊库存等识别维度读取库存；该服务不支持创建、修改或删除库存。对于分析口径，SAP 还提供库存 CDS，例如 `I_StockQuantityValueByType`。这些接口比直接读取物理表更适合作为产品的默认路径。[Material Stock - Read](https://help.sap.com/docs/SAP_S4HANA_CLOUD/3f57e7df4a114edabffe8b2d581a59ed/f68f51a4dc2e46779877a10a301d9138.html)；[Stock Quantity and Value by Type](https://help.sap.com/docs/SAP_S4HANA_CLOUD/c0c54048d35849128be8e872df5bea6d/b98d6b1ecaeb43858666756529e4d09e.html)
4. **S/4HANA 中不能把 MB52 数字简单等同于 MARD、MCHB、MATDOC 或任何单表。** SAP 官方简化文档说明，S/4HANA 引入 MATDOC，物料凭证数据转存到 MATDOC；原来分散在混合表和聚合表中的实际库存数量不再按原方式持久化，而是按新模型动态计算，并通过替代对象等方式维持部分旧访问语义。因此，“查 MARD 就是 MB52”或“汇总 MATDOC 就是 MB52”都不是安全的通用规则。[S/4HANA Simplification List 1511 FPS01](https://help.sap.com/doc/pdfa4322f56824ae221e10000000a4450e5/1511%20001/en-US/SIMPL_OP1511_FPS01.pdf)；[Database Table Annotations — Replacement Object](https://help.sap.com/docs/abap-cloud/abap-development-tools-user-guide/3482ebd9107c4ee0b70eb912465df566.html)
5. **生产系统可以提供自动只读，但必须是显式启用、最小授权、强筛选、有限行数和可追溯的自动只读。** 任意 SQL Console 不应成为默认代理能力；更不能自动使用 `WITH PRIVILEGED ACCESS` 绕过 CDS DCL。产品应记录意图、系统、Client、接口/对象、筛选、页数、行数、时间和结果摘要，并将“数据读取成功”与“口径已对账”分开。

## 2. ADT Data Preview 与 SQL Console 的官方能力边界

### 2.1 Data Preview 可以读取什么

SAP 当前跨产品 ADT 文档明确说明，Data Preview 能够：

- 从 ABAP Dictionary table、View、external View 和 ABAP CDS DDL Source 获取记录；
- 选择显示列；
- 对一个或多个列设置筛选条件；
- 排序、查看 distinct value、保存本地结果；
- 查看 Data Preview 生成的 SQL 日志；
- 设置结果集最大行数。

当前跨产品官方文档给出的默认行数为 **100**，最大值为 **100,000**；较早版本的官方 ADT 指南曾记录最大 **5,000**。因此不能跨系统硬编码 100,000，必须依据目标后端版本和能力响应确定可用上限。无论系统上限是多少，它都不是生产自动化应采用的默认值；产品应设置远低于系统上限的自身安全配额，并要求业务筛选先于读取。[Data Preview](https://help.sap.com/docs/abap-cloud/abap-development-tools-user-guide/data-preview)；[Setting Result-Set Size](https://help.sap.com/docs/ABAP_Cloud/abap-development-tools-user-guide/setting-result-set-size?locale=en-US)；[较早版 ABAP Development User Guide](https://help.sap.com/doc/7c0dc3673ea54d5c97c34f87e2d87c55/Cloud/en-US/abap_dev_user_guide_EN.pdf)

CDS Data Preview 也支持带参数的 View；有参数时，用户需要先提供参数。SAP 同时提醒：如果结果少于预期，可能是 CDS access control role 正在过滤数据。[Previewing Data Records](https://help.sap.com/docs/abap-cloud/abap-development-tools-user-guide/previewing-data-records)

### 2.2 SQL Console 可以做什么，以及为什么不应默认开放给模型

SAP 官方文档说明，SQL Console 可执行采用新 ABAP SQL 语法的 `SELECT`，用于查询和性能分析；可以从项目、Data Preview、Table Editor 或 CDS Editor 打开。其显示行数仍由 Max Rows 控制，而不是依赖语句中自行声明的最大行数。[Working with SQL Console](https://help.sap.com/docs/abap-cloud/abap-development-tools-user-guide/working-with-sql-console)

这证明 ADT 在技术上不只能够读取源码和 DDIC 元数据，也能够读取表/CDS 结果。但它同时意味着更大的数据外泄和性能风险。因此产品应区分：

| 能力 | 推荐默认状态 | 适用范围 |
|---|---|---|
| 固定对象元数据读取（例如 T000 验证） | 可作为连接验证 | 只证明认证和固定路径 |
| Data Preview：批准对象 + 结构化筛选 | 用户显式启用后可自动调用 | 受限表/CDS 的小结果集读取 |
| Released CDS / 官方 OData API | 优先 | 具有业务语义、授权和版本契约的库存读取 |
| SQL Console 任意 `SELECT` | 默认禁止；需独立高风险开关和审批 | 诊断性、非日常自动读取 |
| 任何修改、过账、激活、传输或写接口 | 禁止 | 不属于只读能力 |

### 2.3 连接成功、ADT Data Preview 可用、业务数据可读是三个门槛

SAP 后端配置指南将 `/sap/bc/adt/datapreview/*` 列为独立的 ADT 资源前缀，由 `S_ADT_RES` 进行细粒度授权。指南还提供 `SAP_BC_DWB_WBDISPLAY` 作为仅显示/浏览开发对象的标准角色模板，但开发对象显示权限不能替代库存业务权限。[ADT 后端配置指南](https://help.sap.com/doc/2e65ad9a26c84878b1413009f8ac07c3/202510.002/en-US/config_guide_system_backend_abap_development_tools.pdf)

因此产品的连接检查至少要分层显示：

1. **认证与系统识别**：主机、SID、Client、用户、T000 等固定安全探针；
2. **Data Preview 能力发现**：目标系统是否暴露并允许 `/sap/bc/adt/datapreview/*`；
3. **对象访问**：指定 table/CDS 是否可解析和预览；
4. **业务行级授权**：CDS DCL、PFCG、工厂或其他组织级权限实际允许返回哪些数据；
5. **业务口径验证**：返回结果是否与目标 MB52/Fiori 报表筛选和定义一致。

其中任何一层失败，都不能笼统回答“没有 SAP 连接能力”；应报告具体失败层和下一条可行路径。

## 3. 授权与生产只读边界

### 3.1 ADT 资源授权不等于业务授权

SAP 官方的表访问授权概念使用 `S_TABU_DIS` 按授权组控制，或使用 `S_TABU_NAM` 按表/视图名进行更精确控制；显示通常使用活动值 03。SAP 明确提醒应尽可能限制直接表访问，且生产环境不应使用宽泛通配符。[Table Maintenance: S_TABU_DIS, S_TABU_NAM, S_TABU_CLI](https://help.sap.com/docs/PRODUCT_ID/fd3c83ed48684640a18ac05c8ae4d016/e50e0edcd9c54144b5b614c4ba27204d.html)

对于 CDS，DCL access control 会在 ABAP SQL 读取时隐式增加实例级限制；条件可以基于当前用户的 PFCG 授权。Data Preview 返回数据少于预期，可能正是 DCL 正常生效，而不是读取失败。[Access Control](https://help.sap.com/docs/abap-cloud/abap-data-models/cds-authorization-concept)；[Accessing CDS Objects](https://help.sap.com/docs/abap-cloud/abap-development-tools-user-guide/accessing-cds-objects)

### 3.2 不允许模型绕过 DCL

ABAP SQL 的 `WITH PRIVILEGED ACCESS` 可以忽略 CDS access control，但 SAP 文档明确要求专门权限。对本产品而言，这一能力不应提供给自动代理：

- 不生成或执行包含 `WITH PRIVILEGED ACCESS` 的查询；
- 不因为结果为空或偏少而尝试绕过授权；
- 将“权限导致的空结果”作为一种正常、可解释的结果；
- 需要扩大工厂/组织范围时，转交 SAP 安全管理员审批。

### 3.3 生产环境最小权限建议

SAP 官方指出，从生产角度看，`S_DEVELOP` 是敏感授权，通常不应给生产用户超过显示权限（ACTVT 03）。据此，本产品应使用专用只读技术用户或受控个人用户，权限限定到：

- 明确批准的 ADT Data Preview URI；
- 明确批准的 CDS、table/view 或官方 OData service；
- 必要的工厂、库存组织和业务对象读取范围；
- 无创建、修改、删除、激活、执行任意程序、传输或调试权限。

依据：[ABAP Objects: Authorization Object S_DEVELOP](https://help.sap.com/docs/PRODUCT_ID/fd3c83ed48684640a18ac05c8ae4d016/4fa00d670cff44a5958237334a88af84.html)；[ADT 后端配置指南](https://help.sap.com/doc/2e65ad9a26c84878b1413009f8ac07c3/202510.002/en-US/config_guide_system_backend_abap_development_tools.pdf)。

## 4. 为什么 MB52 不能自动等同为 SE16 单表

### 4.1 经典模型与 S/4HANA 简化模型不同

SAP 的 S/4HANA Simplification List 对库存数据模型的说明包括：

- 经典 ERP 的物料凭证头/项目使用 MKPF、MSEG；库存数量曾分散存放在多张混合表或聚合表中；
- 文档列举 MARC、MARD、MCHB 为同时承载物料主数据属性和实际库存数量的混合表示例，也列举 MSSA 为聚合库存表示例；
- S/4HANA 引入去规范化的 MATDOC，物料凭证数据存储方式发生变化；
- 聚合实际库存不再按经典方式持久化，而是基于新模型动态计算；
- 为兼容旧读取，ABAP SQL 可能通过 replacement object 访问替代对象。

因此即使表名仍存在，读取语义也可能已经由替代对象或兼容机制提供；直接绕过 ABAP SQL 去访问底层数据库，还可能得到与应用层不同的结果。官方资料还建议：需要库存数量时应采用相应的数据访问方法，而不是把经典表选择语句机械搬到 S/4HANA。[S/4HANA Simplification List 1511 FPS01](https://help.sap.com/doc/pdfa4322f56824ae221e10000000a4450e5/1511%20001/en-US/SIMPL_OP1511_FPS01.pdf)；[Database Table Annotations](https://help.sap.com/docs/abap-cloud/abap-development-tools-user-guide/3482ebd9107c4ee0b70eb912465df566.html)

### 4.2 MB52 是报表口径，不只是数据来源

用户说“读取 MB52”通常隐含：

- 当前库存还是历史关键日期库存；
- 工厂、库存地点、物料和批次范围；
- 非限制使用、质检、冻结、受限、在途等库存类型；
- 普通库存还是客户、供应商、销售订单、WBS 等特殊库存；
- 数量单位以及是否需要库存价值；
- 是否包含零库存、删除标识物料或其他报表选择逻辑。

SAP 官方的库存 API 将库存数量建模为一组库存识别键下的数量，并明确区分多种库存类型；库存分析 CDS `I_StockQuantityValueByType` 还包含数量、价值、币种、估价范围、库存类型和特殊库存类型等语义。这些证据说明“总库存”本身就是多维业务指标，不能由代理自行猜测单表与字段后求和。[Material Stock - Read](https://help.sap.com/docs/SAP_S4HANA_CLOUD/3f57e7df4a114edabffe8b2d581a59ed/f68f51a4dc2e46779877a10a301d9138.html)；[Stock Quantity and Value by Type](https://help.sap.com/docs/SAP_S4HANA_CLOUD/c0c54048d35849128be8e872df5bea6d/b98d6b1ecaeb43858666756529e4d09e.html)

## 5. 安全替代 MB52/SE16 的官方路径

### 5.1 路径优先级

| 优先级 | 路径 | 何时使用 | 边界 |
|---|---|---|---|
| 1 | `API_MATERIAL_STOCK` 官方只读 OData API | 已激活服务且授权满足；需要当前库存数量 | API 只读库存，不支持更改、过账或删除；需按服务版本核对覆盖范围 |
| 2 | Released/官方库存 CDS | 目标系统存在并发布；需要当前数量、价值或分析维度 | 版本相关；必须遵守 CDS DCL 与工厂权限，不硬编码跨版本名称 |
| 3 | ADT Data Preview 读取批准的 CDS 或兼容 View | 没有合适 API，但已批准 Data Preview | 强筛选、有限字段、有限行数；对象白名单 |
| 4 | ADT Data Preview 读取批准表 | 诊断或核对，且表语义已经由顾问确认 | 不自动推断 MB52 等价关系；S/4HANA 需识别 replacement object/兼容语义 |
| 5 | 用户从 MB52/Fiori 导出 Excel/CSV | 接口未激活、权限不足、目标口径需要人工确认 | 工具读取本地文件并生成报告，明确来源和导出条件 |

不建议把“自动调用 SE16”作为单独技术方案。SE16 是通用 Data Browser，仍受表授权限制，而且它并不提供比 Data Preview/CDS/API 更稳定的库存业务契约。

### 5.2 官方只读 API

SAP `API_MATERIAL_STOCK` 使用 OData 读取物料库存，可返回按物料、工厂、库存地点、批次、库存类型、特殊库存类型及其他库存识别字段区分的库存数量。SAP 明确说明该服务不能修改、过账或删除库存，并要求通过授权角色访问；文档列出的授权对象包括 `M_MATE_MAN` 和 `M_MATE_WRK`。[Material Stock - Read](https://help.sap.com/docs/SAP_S4HANA_CLOUD/3f57e7df4a114edabffe8b2d581a59ed/f68f51a4dc2e46779877a10a301d9138.html)

SAP 的 on-premise 示例使用 `$filter`、`$select`、`$orderby` 和 `$top` 获取有限库存结果，说明产品可以构造结构化、可审计的读取请求，而不需要生成任意 SQL。[库存地点级库存示例](https://help.sap.com/docs/SAP_S4HANA_CLOUD/3f57e7df4a114edabffe8b2d581a59ed/0805d101dc5140bb91444c3d6271b984.html)；[Get stock list for materials](https://help.sap.com/docs/SAP_S4HANA_ON-PREMISE/eb2a39dd0c124fed8252f684002d55e1/d584e7ff27fd42688915664c4aa91d4a.html)

### 5.3 官方 CDS 与版本发现

可作为候选的官方库存语义包括：

- `I_StockQuantityValueByType`：当前库存数量和价值，包含库存类型、特殊库存类型、工厂、库存地点、基础计量单位和币种等语义；
- `I_MaterialStock`：历史版本文档中的库存基础 View。SAP S/4HANA Cloud 2402 已将其标记为 deprecated，并建议迁移到 `I_MaterialStock_2`；on-premise 版本可见性与发布状态要按实际系统核对。

因此产品不能把某个 CDS 名称写成所有 S/4HANA 版本的唯一答案。每个 Project 应先做能力发现：系统版本、对象是否存在、是否 released、参数、字段、DCL 与授权范围，然后把可用对象保存为经用户确认的只读数据源。[Material Stock (Deprecated)](https://help.sap.com/docs/SAP_S4HANA_CLOUD/c0c54048d35849128be8e872df5bea6d/4c7f68579552346ae10000000a4450e5.html)；[Stock Quantity and Value by Type](https://help.sap.com/docs/SAP_S4HANA_CLOUD/c0c54048d35849128be8e872df5bea6d/b98d6b1ecaeb43858666756529e4d09e.html)

## 6. 意图识别与自动执行建议

### 6.1 先识别业务意图，再选择工具

建议将库存读取至少分为以下意图：

| 意图 | 典型说法 | 优先候选 |
|---|---|---|
| 当前库存 | “读取 MB52”“查 C050 当前库存” | `API_MATERIAL_STOCK` 或当前库存 CDS |
| 历史时点库存 | “查月底/某日库存” | 官方关键日期 CDS/Fiori 报表或用户导出；不能用当前库存替代 |
| 库存数量与价值 | “库存金额、数量、币种” | 数量价值 CDS/Fiori 分析应用 |
| 库存移动明细 | “收发明细、物料凭证” | Material Document API，并强制日期/年度筛选 |
| 技术核对 | “核对某张表/CDS” | 批准对象的 ADT Data Preview |
| 报表完全复刻 | “必须与 MB52 一致” | 先记录全部选择条件，再做样本对账；未对账前标记为近似/候选结果 |

SAP 对 Material Document API 的说明特别建议，在大量凭证上使用查询选项时始终加入过账日期或物料凭证年度，以改善性能。这一原则也应成为库存移动读取的强制护栏。[Read Material Documents](https://help.sap.com/docs/SAP_S4HANA_ON-PREMISE/eb2a39dd0c124fed8252f684002d55e1/78f5a8461d554cc38b3af2d07d6f9c8e.html)

### 6.2 最小澄清信息

当用户只说“读取 MB52 的 C050 库存”时，模型不应直接拒绝，也不应猜表。它应自动完成能力发现，并只在影响口径时补问最少信息：

1. 当前库存还是某个历史日期；
2. 工厂（例如 C050）以及是否限定库存地点；
3. 是否包含全部库存类型和特殊库存；
4. 只要数量，还是同时需要价值/币种；
5. 预期结果是明细、汇总还是与 MB52 完全对账。

若用户已明确这些条件，且 Project 中相应只读工具已经启用，则代理可以直接选择已批准的数据源执行，不应再次要求用户手动导出。

### 6.3 推荐的工具路由

```text
识别为库存读取
  → 确定当前/历史、数量/价值、组织与库存类型口径
  → 检查 Project 的 SAP 只读能力是否由用户启用
  → 探测官方 API / Released CDS / ADT Data Preview 的实际可用性
  → 优先调用业务 API，其次批准 CDS，再次批准表
  → 使用结构化过滤、字段白名单、行数和页数预算执行
  → 保存请求条件、来源对象、授权结果、页数、行数与时间戳
  → 做总计/单位/分类完整性检查
  → 只有完成代表性样本对账后，才标记“与 MB52 口径一致”
```

如果所有在线路径均不可用，才回退到“请用户导出 MB52 Excel/CSV”。回复中应列出已探测的路径及失败原因，例如“Data Preview URI 未授权”“库存 API 未激活”“CDS 对当前工厂无权限”，而不是笼统称“无法连接 SAP”。

## 7. 筛选、行数与分页护栏

### 7.1 Data Preview

- 必须至少包含组织条件；库存场景通常至少限定工厂，广范围读取还需用户确认；
- 默认只选择完成当前任务所需字段；
- 产品默认行数应明显低于目标系统实际公布/探测到的 Data Preview 上限；
- 超过单页预算时先返回数量/范围摘要，让用户确认后再继续；
- 禁止无筛选全表导出；
- 结果落盘时同时保存对象名、过滤条件、最大行数、实际行数和截断标志。

SAP 的 Data Preview 文档公开的是 Max Rows、Refresh 和 Number of Entries，没有承诺可供外部客户端使用的稳定 page/offset/cursor 分页契约。因此这里的“继续”不应解释为对 Data Preview 自动翻页；产品应把它实现为重新收紧筛选或改走支持分页的官方 API。前两项和较低产品限额属于基于 SAP 工具能力作出的安全设计建议，不是 SAP 强制规定。

### 7.2 OData

SAP ABAP Integration and Connectivity 文档说明，`$top` 用于限制返回项目数，`$skip` 用于跳过前若干项目；服务驱动分页时，客户端应跟随响应提供的 next link，而不是自行改写其中的 skip token。[`$skip` and `$top` Options](https://help.sap.com/docs/abap-cloud/abap-integration-connectivity/skip-and-top-options)；[Response Size Reduction Via `$skiptoken`](https://help.sap.com/docs/SAP_NETWEAVER_AS_ABAP_752/68bf513362174d54b58cddec28794093/0de0316a3eed4407800eae966b1ceb53.html)

产品实现应：

- 请求明确 `$select`、`$filter`、`$orderby` 和每页 `$top`；
- 若服务返回 next link，按原样跟随；
- 设置总页数、总行数、总耗时和响应体积上限；
- 支持用户取消；
- 达到预算时保留已读取数据并标记“不完整/已截断”，不能静默声称是全部库存。

## 8. 产品落地验收标准

### 8.1 连接与能力中心

- 将“T000 连接验证”“ADT Data Preview”“官方库存 API”“库存 CDS”“允许 AI 自动调用”显示为不同状态；
- 所有能力默认关闭，由用户逐项启用；
- 对每项能力显示系统、Client、验证时间、只读边界和最近一次失败原因；
- 不因某条读取路径失败而否定其他路径。

### 8.2 工具接口

库存工具不应接收自由 SQL，而应接收结构化业务参数，例如：意图、关键日期、工厂、库存地点、物料范围、库存类型、是否需要价值、汇总维度、最大行数。工具内部再根据当前 Project 已确认的数据源映射到 API/CDS/Data Preview。

表/CDS 诊断工具应另行建模，要求对象白名单和字段/过滤器白名单；库存意图路由器不能自行把 MB52 映射成某个经典表。

### 8.3 结果可信度

每份在线库存结果至少标记：

- 数据系统、SID、Client 与读取时间；
- 来源类型和技术名称（API/CDS/View/Table）；
- 输入筛选、单位、币种、库存类型和特殊库存范围；
- 实际行数、页数、是否截断；
- 授权是否可能过滤结果；
- “已读取真实数据”“已完成完整性检查”“已与 MB52/Fiori 对账”三个独立状态。

在没有相同选择条件下的代表性对账之前，不应使用“完全等同 MB52”的表述。

## 9. 官方资料索引

1. [SAP ADT — Data Preview](https://help.sap.com/docs/abap-cloud/abap-development-tools-user-guide/data-preview)
2. [SAP ADT — Setting Result-Set Size](https://help.sap.com/docs/ABAP_Cloud/abap-development-tools-user-guide/setting-result-set-size?locale=en-US)
3. [SAP ADT — Working with SQL Console](https://help.sap.com/docs/abap-cloud/abap-development-tools-user-guide/working-with-sql-console)
4. [Configuring the ABAP Back-End for ADT for Eclipse](https://help.sap.com/doc/2e65ad9a26c84878b1413009f8ac07c3/202510.002/en-US/config_guide_system_backend_abap_development_tools.pdf)
5. [ABAP CDS — Access Control](https://help.sap.com/docs/abap-cloud/abap-data-models/cds-authorization-concept)
6. [ADT — Accessing CDS Objects](https://help.sap.com/docs/abap-cloud/abap-development-tools-user-guide/accessing-cds-objects)
7. [Database Table Annotations and Replacement Objects](https://help.sap.com/docs/abap-cloud/abap-development-tools-user-guide/3482ebd9107c4ee0b70eb912465df566.html)
8. [S/4HANA Simplification List 1511 FPS01](https://help.sap.com/doc/pdfa4322f56824ae221e10000000a4450e5/1511%20001/en-US/SIMPL_OP1511_FPS01.pdf)
9. [Material Stock - Read API](https://help.sap.com/docs/SAP_S4HANA_CLOUD/3f57e7df4a114edabffe8b2d581a59ed/f68f51a4dc2e46779877a10a301d9138.html)
10. [Operations for Material Stock API（on-premise）](https://help.sap.com/docs/SAP_S4HANA_ON-PREMISE/eb2a39dd0c124fed8252f684002d55e1/dfc5b3e292874297843ed6cfb08eb83a.html)
11. [Stock Quantity and Value by Type CDS](https://help.sap.com/docs/SAP_S4HANA_CLOUD/c0c54048d35849128be8e872df5bea6d/b98d6b1ecaeb43858666756529e4d09e.html)
12. [Material Stock CDS deprecation and successor](https://help.sap.com/docs/SAP_S4HANA_CLOUD/c0c54048d35849128be8e872df5bea6d/4c7f68579552346ae10000000a4450e5.html)
13. [SAP Gateway — `$skip` and `$top`](https://help.sap.com/docs/abap-cloud/abap-integration-connectivity/skip-and-top-options)
14. [SAP Gateway — Server-driven paging and next link](https://help.sap.com/docs/SAP_NETWEAVER_AS_ABAP_752/68bf513362174d54b58cddec28794093/0de0316a3eed4407800eae966b1ceb53.html)
15. [Table authorization objects](https://help.sap.com/docs/PRODUCT_ID/fd3c83ed48684640a18ac05c8ae4d016/e50e0edcd9c54144b5b614c4ba27204d.html)

## 10. 研究限制

- SAP Help 中 Cloud、Private Cloud 和 on-premise 的对象名称、版本与可用范围并不完全相同；最终实现必须以目标系统的 discovery、对象元数据和已激活服务为准。
- SAP 官方文档可以证明 ADT Data Preview 与 SQL Console 的能力，但不保证当前系统用户拥有这些权限。
- 本文没有读取用户的生产业务数据，也没有验证 C050 在目标系统中的库存口径。
- MB52 的客户增强、变式、权限和版本行为可能影响结果；产品必须通过目标系统样本对账建立等价性，不能从通用文档直接宣布等价。
