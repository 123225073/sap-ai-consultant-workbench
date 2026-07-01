from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "docs" / "product-prototype" / "images"


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    candidates = [
        Path("C:/Windows/Fonts/msyhbd.ttc" if bold else "C:/Windows/Fonts/msyh.ttc"),
        Path("C:/Windows/Fonts/simhei.ttf"),
        Path("C:/Windows/Fonts/arial.ttf"),
    ]
    for candidate in candidates:
        if candidate.exists():
            return ImageFont.truetype(str(candidate), size)
    return ImageFont.load_default()


F12 = font(12)
F13 = font(13)
F14 = font(14)
F15 = font(15)
F16 = font(16)
F17 = font(17)
F18 = font(18)
F20 = font(20)
F22 = font(22, True)
F24 = font(24, True)
F28 = font(28, True)


def rounded(draw, box, radius=8, fill="#ffffff", outline="#d8dee8", width=1):
    draw.rounded_rectangle(box, radius=radius, fill=fill, outline=outline, width=width)


def text(draw, xy, value, fill="#1f2937", fnt=F14):
    draw.text(xy, value, fill=fill, font=fnt)


def tag(draw, xy, value, fill="#e8f5ef", color="#16834a"):
    x, y = xy
    w = 12 + len(value) * 12
    rounded(draw, (x, y, x + w, y + 24), 6, fill=fill, outline=fill)
    text(draw, (x + 8, y + 3), value, color, F12)


def shell(title: str):
    img = Image.new("RGB", (1600, 1000), "#f7f8fb")
    draw = ImageDraw.Draw(img)
    draw.rectangle((0, 0, 1600, 52), fill="#ffffff", outline="#dde3ea")
    text(draw, (24, 15), "☰    ←    →     文件    编辑    视图    帮助", "#111827", F16)
    text(draw, (690, 14), "●  SAP AI 顾问工作台   个人版 MVP", "#111827", F18)
    draw.ellipse((677, 20, 689, 32), fill="#22c55e")
    text(draw, (1460, 14), "—    □    ×", "#111827", F18)
    draw.rectangle((0, 52, 300, 1000), fill="#fbfcfe", outline="#dde3ea")
    y = 82
    for label in ["＋  新案件", "⌕  搜索", "⚙  配置中心", "▣  规范中心", "▤  知识库"]:
        text(draw, (26, y), label, "#111827", F18)
        y += 42
    draw.line((0, 318, 300, 318), fill="#e5e9f0")
    text(draw, (24, 344), "项目", "#6b7280", F14)
    rounded(draw, (118, 334, 222, 366), 7, "#ffffff")
    text(draw, (140, 340), "+ 添加项目", "#111827", F14)
    rounded(draw, (10, 382, 290, 590), 8, "#ffffff")
    text(draw, (24, 398), "SAP  演示 S4HANA", "#111827", F18)
    tag(draw, (72, 426), "DEV/100")
    tag(draw, (152, 426), "只读")
    for item, status, sy in [
        ("DEMO001 演示BOM清单", "", 470),
        ("DEMO002 接口分析", "处理中", 516),
        ("DEMO003 演示物料逻辑", "已归档", 562),
    ]:
        text(draw, (40, sy), item, "#111827", F15)
        if status:
            tag(draw, (214, sy - 2), status, "#fff3e7" if status == "处理中" else "#eef2f7", "#f97316" if status == "处理中" else "#6b7280")
    rounded(draw, (10, 614, 290, 758), 8, "#ffffff")
    text(draw, (24, 632), "SAP  演示 ECC", "#111827", F18)
    tag(draw, (72, 660), "QAS/200", "#fff3e7", "#f97316")
    text(draw, (40, 706), "DEMO004 库存差异", "#111827", F15)
    draw.line((0, 914, 300, 914), fill="#e5e9f0")
    draw.ellipse((26, 932, 74, 980), fill="#2563eb")
    text(draw, (40, 945), "DE", "#ffffff", F16)
    text(draw, (88, 934), "演示用户", "#111827", F16)
    text(draw, (88, 960), "本地个人版", "#6b7280", F14)
    text(draw, (330, 82), title, "#111827", F28)
    return img, draw


def main_workbench():
    img, draw = shell("DEMO001 演示BOM清单")
    draw.rectangle((300, 52, 1180, 1000), fill="#ffffff", outline="#dde3ea")
    text(draw, (340, 110), "演示 S4HANA · DEV/100 · 只读", "#6b7280", F16)
    rounded(draw, (720, 154, 1138, 194), 12, "#f3f4f6", "#f3f4f6")
    text(draw, (744, 164), "帮我分析 DEMO001 演示BOM清单，确认为什么部分工厂没有数据。", "#111827", F15)
    text(draw, (1088, 206), "10:24", "#6b7280", F14)
    text(draw, (340, 246), "已处理 2m 58s  >", "#6b7280", F14)
    text(draw, (340, 284), "已确认：问题来自演示BOM筛选口径与当前业务范围不一致。", "#111827", F16)
    for line, y in [
        ("• 原因：筛选条件中的工厂范围仍使用旧口径，部分工厂未被包含。", 324),
        ("• 建议：调整为当前业务口径，并增加异常工厂提示。", 364),
        ("• 已生成文件：演示BOM核对.xlsx、逻辑说明图.png、开发说明书.md", 404),
    ]:
        text(draw, (360, y), line, "#111827", F16)
    for x, name, color in [
        (340, "演示BOM核对.xlsx\n256 KB", "#22c55e"),
        (520, "逻辑说明图.png\n128 KB", "#3b82f6"),
        (700, "开发说明书.md\n18 KB", "#2563eb"),
    ]:
        rounded(draw, (x, 456, x + 160, 520), 8, "#ffffff")
        text(draw, (x + 18, 470), "□", color, F22)
        text(draw, (x + 50, 466), name, "#111827", F14)
    rounded(draw, (540, 790, 1160, 980), 10, "#ffffff")
    text(draw, (566, 810), "问题分析   ABAP开发   文档生成   画流程图", "#2563eb", F15)
    text(draw, (566, 876), "继续追问，或 @引用 SAP 对象 / 文档 / 历史案件", "#9ca3af", F16)
    rounded(draw, (566, 930, 720, 966), 6, "#ffffff")
    text(draw, (584, 938), "演示渠道 · demo-model", "#111827", F13)
    rounded(draw, (1098, 920, 1148, 970), 10, "#2563eb", "#2563eb")
    text(draw, (1115, 932), "➤", "#ffffff", F24)
    draw.rectangle((1180, 52, 1600, 1000), fill="#ffffff", outline="#dde3ea")
    text(draw, (1210, 82), "当前案件文件", "#111827", F22)
    rounded(draw, (1210, 116, 1566, 154), 8, "#ffffff")
    text(draw, (1230, 124), "⌕ 搜索当前案件文件", "#9ca3af", F15)
    files = [
        ("README.md", "10:20"),
        ("conversation.md", "10:24"),
        ("outputs/", ""),
        ("  演示BOM核对.xlsx", "10:26"),
        ("  逻辑说明图.png", "10:26"),
        ("  开发说明书.md", "10:26"),
        ("knowledge_candidates/", ""),
        ("  演示BOM筛选规则.md", "待确认"),
        ("technical/", ""),
    ]
    y = 190
    for name, meta in files:
        text(draw, (1220, y), name, "#111827", F16)
        if meta:
            text(draw, (1480, y), meta, "#6b7280" if meta != "待确认" else "#f97316", F14)
        y += 44
    text(draw, (1210, 950), "6 个项目", "#4b5563", F14)
    img.save(OUT / "01-main-workbench.png")


def config_center():
    img, draw = shell("配置中心")
    draw.rectangle((300, 52, 1600, 1000), fill="#ffffff", outline="#dde3ea")
    text(draw, (370, 122), "当前项目：演示 S4HANA · DEV/100", "#6b7280", F16)
    draw.rectangle((350, 160, 600, 1000), fill="#fbfcfe", outline="#e5e9f0")
    for label, y in [
        ("ⓘ  项目概览", 200),
        ("◇  ADT连接", 258),
        ("✈  飞书CLI", 316),
        ("▣  API与模型", 374),
        ("⌘  Codex能力", 432),
        ("▤  本地存储", 490),
    ]:
        if "ADT" in label:
            rounded(draw, (362, y - 12, 586, y + 30), 8, "#eaf2ff", "#eaf2ff")
            text(draw, (388, y), label, "#2563eb", F18)
        else:
            text(draw, (388, y), label, "#111827", F18)
    text(draw, (640, 192), "ADT连接", "#111827", F24)
    fields = [("系统别名", "演示开发系统"), ("SAP URL", "https://sap-demo.example.com"), ("Client", "100"), ("用户", "DEMO_USER"), ("语言", "ZH"), ("SSL", "跳过证书验证"), ("写入权限", "只读模式")]
    y = 250
    for k, v in fields:
        text(draw, (640, y), k, "#374151", F16)
        rounded(draw, (770, y - 10, 1200, y + 28), 7, "#ffffff")
        text(draw, (790, y - 2), v, "#111827", F16)
        y += 58
    rounded(draw, (640, 610, 790, 650), 8, "#2563eb", "#2563eb")
    text(draw, (676, 618), "保存配置", "#ffffff", F16)
    rounded(draw, (810, 610, 970, 650), 8, "#ffffff")
    text(draw, (858, 618), "测试连接", "#111827", F16)
    rounded(draw, (990, 610, 1188, 650), 8, "#ffffff")
    text(draw, (1032, 618), "读取T000验证", "#111827", F16)
    rounded(draw, (640, 680, 1200, 830), 8, "#ffffff")
    for label, value, y in [("配置状态", "已保存", 704), ("连接测试", "通过", 746), ("读取验证", "T000读取成功", 788), ("写入模式", "禁用（只读模式）", 830)]:
        text(draw, (670, y), label, "#374151", F16)
        text(draw, (840, y), "● " + value, "#16a34a", F16)
    draw.rectangle((1230, 160, 1580, 1000), fill="#ffffff", outline="#e5e9f0")
    text(draw, (1260, 200), "验证说明", "#111827", F22)
    for label, y in [("URL/Client 正确", 284), ("账号可登录", 340), ("ADT 服务可用", 396), ("T000 可读取", 452), ("写入权限已禁用", 508)]:
        text(draw, (1284, y), "✓ " + label, "#16a34a", F17)
    rounded(draw, (1260, 596, 1538, 666), 8, "#fff7ed", "#fed7aa")
    text(draw, (1282, 612), "密码和敏感信息不会明文展示，\n仅用于本地安全连接。", "#92400e", F15)
    img.save(OUT / "02-config-center.png")


def standards_center():
    img, draw = shell("规范中心")
    draw.rectangle((300, 52, 1600, 1000), fill="#ffffff", outline="#dde3ea")
    text(draw, (370, 122), "当前项目：演示 S4HANA · S4模板副本", "#6b7280", F16)
    for x, label in [(720, "从模板迁移"), (870, "从其他项目复制"), (1050, "导入规范"), (1180, "保存版本")]:
        rounded(draw, (x, 110, x + 130, 148), 7, "#ffffff")
        text(draw, (x + 20, 118), label, "#111827", F15)
    draw.rectangle((350, 170, 610, 990), fill="#fbfcfe", outline="#e5e9f0")
    text(draw, (378, 198), "规范类别", "#111827", F20)
    cats = ["ABAP开发规范", "注释规范", "请求号描述", "ALV报表规范", "接口开发规范", "文档模板", "流程图规范", "Excel导出模板"]
    y = 250
    for c in cats:
        if c == "ABAP开发规范":
            rounded(draw, (362, y - 12, 598, y + 30), 8, "#eaf2ff", "#eaf2ff")
            text(draw, (396, y), c, "#2563eb", F17)
        else:
            text(draw, (396, y), c, "#111827", F17)
        y += 62
    draw.rectangle((625, 170, 1208, 990), fill="#ffffff", outline="#e5e9f0")
    text(draw, (656, 200), "ABAP开发规范", "#111827", F24)
    text(draw, (1030, 204), "最后保存：今天 10:25", "#6b7280", F14)
    body = [
        "1. 适用范围",
        "   适用于演示 S4HANA 项目下所有自开发对象。",
        "2. 命名规则",
        "   所有演示对象以 DEMO 开头，例如 DEMO001。",
        "   程序、函数、类使用全大写，不超过 30 个字符。",
        "3. 注释规则",
        "   关键业务逻辑必须说明输入、处理和输出。",
        "4. 文本元素规则",
        "   文本元素集中维护，不在程序中硬编码。",
        "5. 修改已有对象流程",
        "   先读取用途和历史变更，保存快照后再生成建议。",
    ]
    y = 252
    for line in body:
        text(draw, (660, y), line, "#111827", F16 if not line[0:1].isdigit() else F18)
        y += 42
    rounded(draw, (650, 874, 820, 918), 8, "#2563eb", "#2563eb")
    text(draw, (674, 884), "保存当前项目规范", "#ffffff", F15)
    rounded(draw, (840, 874, 990, 918), 8, "#ffffff")
    text(draw, (868, 884), "测试生成示例", "#111827", F15)
    draw.rectangle((1220, 170, 1578, 990), fill="#ffffff", outline="#e5e9f0")
    text(draw, (1250, 200), "差异与版本", "#111827", F22)
    text(draw, (1250, 258), "来源：S4通用模板 v1.3", "#6b7280", F16)
    for label, status, y in [("注释规范", "已修改", 334), ("请求描述", "相同", 390), ("ALV规范", "已修改", 446), ("ECC规则", "不适用", 502)]:
        rounded(draw, (1250, y, 1538, y + 44), 7, "#ffffff")
        text(draw, (1272, y + 12), label, "#374151", F15)
        text(draw, (1440, y + 12), status, "#f97316" if status == "已修改" else "#16a34a" if status == "相同" else "#6b7280", F15)
    rounded(draw, (1250, 830, 1538, 900), 8, "#fff7ed", "#fed7aa")
    text(draw, (1280, 846), "修改仅影响当前项目，\n不会覆盖来源模板。", "#92400e", F15)
    img.save(OUT / "03-standards-center.png")


def knowledge_center():
    img, draw = shell("知识库")
    draw.rectangle((300, 52, 1600, 1000), fill="#ffffff", outline="#dde3ea")
    text(draw, (370, 122), "当前项目：演示 S4HANA · 已发布 128 · 待确认 6 · 冲突 2", "#6b7280", F16)
    for x, label in [(370, "上传文档"), (500, "导入QA表"), (630, "从飞书同步"), (790, "批量审核")]:
        rounded(draw, (x, 158, x + 118, 198), 7, "#ffffff")
        text(draw, (x + 24, 168), label, "#111827", F15)
    rounded(draw, (1110, 158, 1500, 198), 8, "#ffffff")
    text(draw, (1130, 168), "⌕ 搜索问题、SAP对象、文档、逻辑图、QA", "#9ca3af", F15)
    draw.rectangle((340, 220, 510, 842), fill="#fbfcfe", outline="#e5e9f0")
    for label, count, y in [("全部知识", "136", 260), ("待确认", "6", 318), ("已发布", "128", 376), ("有冲突", "2", 434), ("已失效", "4", 492), ("文档库", "42", 570), ("QA问答", "37", 628), ("SAP对象说明", "31", 686), ("时间线事实", "26", 744)]:
        text(draw, (366, y), label, "#2563eb" if label == "待确认" else "#111827", F16)
        text(draw, (470, y), count, "#2563eb" if label == "待确认" else "#6b7280", F14)
    draw.rectangle((510, 220, 1010, 842), fill="#ffffff", outline="#e5e9f0")
    text(draw, (540, 248), "待确认（6）", "#111827", F18)
    items = [
        ("演示BOM筛选规则", "待确认", "DEMO001案件 · 对象：DEMO001", "置信度 92%"),
        ("DEMO001历史修改说明", "待确认", "DEMO001案件 · 对象：DEMO001", "置信度 88%"),
        ("演示接口口径", "有冲突", "演示 ECC 项目 · 对象：DEMO_API", "冲突数 2"),
        ("字段含义补充", "已发布", "字段说明.docx · 对象：DEMO_TABLE", "置信度 95%"),
    ]
    y = 300
    for title, status, meta, confidence in items:
        rounded(draw, (535, y, 990, y + 72), 8, "#f8fbff" if y == 300 else "#ffffff", "#2563eb" if y == 300 else "#e5e9f0")
        text(draw, (560, y + 12), title, "#111827", F17)
        tag(draw, (720, y + 10), status, "#fff3e7" if status != "已发布" else "#e8f5ef", "#f97316" if status != "已发布" else "#16834a")
        text(draw, (560, y + 42), meta, "#6b7280", F13)
        text(draw, (880, y + 42), confidence, "#6b7280", F13)
        y += 94
    draw.rectangle((1010, 220, 1500, 842), fill="#ffffff", outline="#e5e9f0")
    text(draw, (1040, 250), "演示BOM筛选规则", "#111827", F22)
    tag(draw, (1242, 250), "待确认", "#fff3e7", "#f97316")
    details = [("项目", "演示 S4HANA"), ("来源", "DEMO001 演示BOM清单"), ("SAP对象", "DEMO001、DEMO_TABLE"), ("生效时间", "2026-07-01"), ("状态", "待确认")]
    y = 320
    for k, v in details:
        text(draw, (1040, y), k, "#6b7280", F15)
        text(draw, (1150, y), v, "#111827", F15)
        y += 34
    text(draw, (1040, 500), "内容预览", "#111827", F17)
    rounded(draw, (1040, 532, 1460, 598), 8, "#ffffff")
    text(draw, (1062, 548), "演示BOM清单筛选时，应以当前业务确认的工厂范围为准，旧口径仅作为历史参考。", "#374151", F14)
    rounded(draw, (1040, 642, 1460, 706), 8, "#fff7ed", "#fed7aa")
    text(draw, (1062, 658), "发现旧知识适用于 ECC 项目，当前知识适用于 S4HANA，不直接覆盖。", "#92400e", F14)
    rounded(draw, (1040, 786, 1170, 828), 8, "#2563eb", "#2563eb")
    text(draw, (1075, 796), "确认入库", "#ffffff", F16)
    rounded(draw, (1190, 786, 1330, 828), 8, "#ffffff")
    text(draw, (1218, 796), "编辑后入库", "#111827", F16)
    rounded(draw, (1350, 786, 1460, 828), 8, "#ffffff")
    text(draw, (1378, 796), "暂不处理", "#111827", F16)
    draw.rectangle((340, 860, 1500, 980), fill="#ffffff", outline="#e5e9f0")
    text(draw, (365, 884), "文档解析队列（3）", "#111827", F18)
    for x, name, state in [(365, "开发说明书_DEMO001.docx", "已解析"), (690, "演示BOM核对.xlsx", "已索引"), (1015, "历史会议纪要.pdf", "需人工确认表格")]:
        rounded(draw, (x, 916, x + 285, 966), 8, "#ffffff")
        text(draw, (x + 20, 930), name, "#111827", F14)
        text(draw, (x + 190, 930), state, "#16a34a" if state != "需人工确认表格" else "#f97316", F13)
    img.save(OUT / "04-knowledge-center.png")


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    main_workbench()
    config_center()
    standards_center()
    knowledge_center()
    print(f"Generated sanitized prototype images in {OUT}")
