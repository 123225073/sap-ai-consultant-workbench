export type SapReadonlyIntent = "sap-data-read" | "sap-object-read" | null;

const READ_ACTION = /(读取|查询|查看|检查|核对|分析|导出|下载|获取|检索|搜索|连接.*(?:读取|查询|查看)|read|query|check|inspect|analy[sz]e|export|download|fetch|search)/i;
const SAP_CONTEXT = /(\bSAP\b|\bSAP[A-Z0-9_/$-]{3,}\b|S\/4|S4HANA|ECC|ADT|ABAP|DDIC|CDS|Client\s*\d{3}|客户端\s*\d{3}|\bSID\b|生产系统|测试系统|开发系统|事务码|TCode|SE16|SE16N|MB\d{2}|VA\d{2}|ME\d{2})/i;
const BUSINESS_DATA = /(业务数据|实际数据|明细|报表|库存|库龄|订单|凭证|物料|客户|供应商|销售|采购|财务|成本|余额|主数据|配置值|表数据|数据表|工厂|仓库|批次|data|rows?|inventory|stock|orders?|documents?|balance)/i;
const OBJECT_SOURCE = /(源码|源代码|程序|类|函数|function module|include|接口|结构|数据字典|表结构|字段定义|对象定义|where-used|引用位置|program|class|source code|metadata|\bCDS\b)/i;
const EXPLICIT_TABLE_DATA = /(?:SAP\s*)?(?:表|table)\s+[A-Z][A-Z0-9_/$-]{2,79}[^，。；\n]{0,20}(?:数据|记录|明细|行|data|records?|rows?)/i;
const EXPLICIT_CDS_DATA = /\bCDS\b\s+[A-Z][A-Z0-9_/$-]{2,79}[^，。；\n]{0,20}(?:数据|记录|明细|行|data|records?|rows?)/i;

// Only block actions that clearly mutate SAP. Local deliverables such as HTML, PPT,
// Markdown or Excel remain compatible with an earlier read-only SAP step.
const SAP_MUTATION = /(写入\s*(?:SAP|S\/4|ECC|ABAP|系统|表|对象|程序|类|函数|订单|凭证)|(?:修改|更新|删除|激活|过账|冲销|改成|调整|变更)\s*(?:SAP|S\/4|ECC|ABAP|系统|表|对象|程序|类|函数|订单|凭证|物料|主数据)|(?:修改|更新|删除|激活|过账|冲销|改成|调整|变更)[^，。；\n]{0,20}(?:状态|价格|数量|金额|订单|凭证|物料|主数据|配置值)|(?:状态|价格|数量|金额|订单|凭证|物料|主数据|配置值)[^，。；\n]{0,20}(?:修改|更新|删除|改成|调整|变更)|(?:创建|释放)\s*(?:传输|请求|SAP\s*对象|ABAP\s*对象|订单|凭证|物料)|发布\s*(?:到|至)\s*(?:SAP|S\/4|ECC|系统)|write\s+(?:to\s+)?sap|(?:update|change|adjust)\s+(?:the\s+)?(?:sap|abap|table|object|status|price|quantity|amount)|delete\s+(?:sap|abap|table|object)|create\s+(?:transport|sap\s+object|abap\s+object)|activate\s+(?:sap|abap|program|class|object)|release\s+transport|post\s+(?:document|to\s+sap))/i;
const NEGATED_MUTATION = /(?:禁止|不要|不得|不允许|不能|无需)\s*(?:执行|进行|向)?\s*(?:任何)?\s*(?:SAP|S\/4|ECC|ABAP|系统)?\s*(?:写入|修改|更新|删除|激活|过账|冲销|创建传输|释放传输|发布)|(?:do\s+not|don't|must\s+not|never)\s+(?:write|update|change|delete|activate|post|create\s+transport|release\s+transport)(?:\s+(?:to\s+)?sap)?/gi;

function containsConnectionHint(content: string, hint: string): boolean {
  const normalizedHint = hint.trim().normalize("NFKC");
  if (!normalizedHint) return false;
  if (/^[A-Za-z0-9_-]+$/.test(normalizedHint)) {
    const escaped = normalizedHint.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|[^A-Za-z0-9_-])${escaped}($|[^A-Za-z0-9_-])`, "i").test(content);
  }
  return normalizedHint.length >= 3 && content.toLocaleLowerCase().includes(normalizedHint.toLocaleLowerCase());
}

/**
 * Routes only explicit read-only SAP requests. Object/source intent wins over
 * business nouns so "查看物料表 MARA 字段定义" is metadata, not row data.
 */
export function detectSapReadonlyIntent(content: string, projectConnectionHints: readonly string[] = []): SapReadonlyIntent {
  const normalized = content.trim();
  const mutationCandidate = normalized.replace(NEGATED_MUTATION, "");
  if (!normalized || SAP_MUTATION.test(mutationCandidate)) return null;
  const hasProjectConnectionHint = projectConnectionHints.some((hint) => containsConnectionHint(normalized, hint));
  if (!READ_ACTION.test(normalized) || (!SAP_CONTEXT.test(normalized) && !hasProjectConnectionHint)) return null;
  if (EXPLICIT_TABLE_DATA.test(normalized) || EXPLICIT_CDS_DATA.test(normalized)) return "sap-data-read";
  if (OBJECT_SOURCE.test(normalized)) return "sap-object-read";
  if (BUSINESS_DATA.test(normalized)) return "sap-data-read";
  return null;
}
