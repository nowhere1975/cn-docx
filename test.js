#!/usr/bin/env node
/**
 * cn-docx 自动化测试
 * node test.js
 */

const { generate, dateToChinese, dateToArabic } = require('./generate.js');
const fs   = require('fs');
const path = require('path');

const OUT = './test-output';
fs.mkdirSync(OUT, { recursive: true });

const results = [];

async function test(name, opts) {
  try {
    const out = await generate(opts);
    const size = fs.statSync(out).size;
    if (size < 1000) throw new Error('文件过小');
    results.push({ name, status: '✅', file: path.basename(out), size });
  } catch (e) {
    results.push({ name, status: '❌', error: e.message });
  }
}

async function run() {
  console.log('开始测试 cn-docx...\n');

  // ══ 一、公文模式（official）- standard ══

  await test('通知 standard', {
    mode: 'official', style: 'standard', docType: 'tongzhi',
    outputPath: `${OUT}/通知.docx`,
    content: {
      title: '关于加强安全生产工作的通知',
      recipient: '各部门、各单位：',
      org: '某市应急管理局',
      date: dateToChinese('2026-03-15'),
      body: [
        { level: 0, text: '为加强安全生产工作，现将有关事项通知如下。' },
        { level: 1, number: '一', heading: '高度重视' },
        { level: 0, text: '各单位要认真落实安全生产责任制。' },
        { level: 2, number: '（一）', heading: '检查范围' },
        { level: 0, text: '覆盖全市所有生产经营单位。' },
        { level: 3, number: '1.', heading: '危险化学品企业。', text: '重点检查储存环节和运输环节。' },
        { level: 4, number: '（1）', text: '重点检查储存环节。' },
      ],
      attachments: ['安全生产检查表'],
    },
  });

  await test('报告（无主送机关）', {
    mode: 'official', style: 'standard', docType: 'baogao',
    outputPath: `${OUT}/报告.docx`,
    content: {
      title: '关于2026年度工作情况的报告',
      org: '某市人民政府办公室',
      date: dateToChinese('2026-03-15'),
      body: [
        { level: 0, text: '现将2026年度工作情况报告如下。' },
        { level: 1, number: '一', heading: '总体情况' },
        { level: 0, text: '全年工作总体平稳。' },
      ],
    },
  });

  await test('请示', {
    mode: 'official', style: 'standard', docType: 'qingshi',
    outputPath: `${OUT}/请示.docx`,
    content: {
      title: '关于申请追加专项经费的请示',
      recipient: '市财政局：',
      org: '某局办公室',
      date: dateToChinese('2026-03-15'),
      body: [
        { level: 0, text: '特申请追加专项经费50万元，理由如下。' },
        { level: 1, number: '一', heading: '申请原因' },
        { level: 0, text: '年初预算编制时未充分考虑实际需求。' },
        { level: 0, text: '以上请示妥否，请批示。' },
      ],
    },
  });

  await test('函', {
    mode: 'official', style: 'standard', docType: 'han',
    outputPath: `${OUT}/函.docx`,
    content: {
      title: '关于商请协助开展联合检查的函',
      recipient: '××市应急管理局：',
      org: '某市安委办',
      date: dateToChinese('2026-03-15'),
      body: [{ level: 0, text: '特函请贵局予以协助配合。' }],
    },
  });

  await test('纪要', {
    mode: 'official', style: 'standard', docType: 'jiyao',
    outputPath: `${OUT}/纪要.docx`,
    content: {
      title: '安全生产工作专题会议纪要',
      org: '某市人民政府办公室',
      date: dateToChinese('2026-03-15'),
      body: [
        { level: 0, text: '2026年3月15日，市政府召开专题会议，纪要如下。' },
        { level: 1, number: '一', heading: '议定事项' },
        { level: 0, text: '于4月底前完成全市安全生产大检查。' },
      ],
    },
  });

  // ══ 二、公文模式（official）- strict 红头公文 ══

  await test('strict 红头公文（下行文）', {
    mode: 'official', style: 'strict', docType: 'tongzhi',
    outputPath: `${OUT}/红头通知.docx`,
    content: {
      title: '关于开展安全生产大检查的通知',
      recipient: '各县区人民政府，市直各单位：',
      org: '某市人民政府',
      doc_number: '某政发〔2026〕1号',
      date: dateToChinese('2026-03-15'),
      cc: '市安委会各成员单位',
      print_org: '某市人民政府办公室',
      print_date: '2026年3月15日',
      body: [
        { level: 0, text: '决定开展全市安全生产大检查，现将有关事项通知如下。' },
        { level: 1, number: '一', heading: '检查时间' },
        { level: 0, text: '2026年4月1日至6月30日。' },
        { level: 1, number: '二', heading: '检查范围' },
        { level: 0, text: '全市所有生产经营单位。' },
      ],
      attachments: ['安全生产检查表'],
    },
  });

  await test('strict 红头公文（含份号密级紧急）', {
    mode: 'official', style: 'strict', docType: 'tongzhi',
    outputPath: `${OUT}/红头通知_全要素.docx`,
    content: {
      title: '关于紧急开展防汛工作的通知',
      recipient: '各县区人民政府：',
      org: '某市人民政府',
      doc_number: '某政急发〔2026〕5号',
      serial_number: '000001',
      secret_level: '机密★1年',
      urgency: '特急',
      date: dateToChinese('2026-03-15'),
      cc: '市防汛指挥部成员单位',
      body: [
        { level: 0, text: '根据气象部门预报，现紧急通知如下。' },
        { level: 1, number: '一', heading: '立即启动应急预案' },
        { level: 0, text: '各县区立即启动防汛四级应急响应。' },
      ],
    },
  });

  await test('strict 红头公文（上行文带签发人）', {
    mode: 'official', style: 'strict', docType: 'qingshi',
    outputPath: `${OUT}/红头请示_签发人.docx`,
    content: {
      title: '关于申请设立应急物资储备库的请示',
      recipient: '省应急管理厅：',
      org: '某市应急管理局',
      doc_number: '某应急发〔2026〕12号',
      signers: ['张三'],
      date: dateToChinese('2026-03-15'),
      body: [
        { level: 0, text: '为加强应急物资保障能力，特请示如下。' },
        { level: 0, text: '以上请示妥否，请批复。' },
      ],
    },
  });

  await test('含中文引号', {
    mode: 'official', style: 'standard', docType: 'tongzhi',
    outputPath: `${OUT}/含引号.docx`,
    content: {
      title: '关于贯彻落实"安全第一"方针的通知',
      recipient: '各部门：',
      org: '办公室',
      date: dateToChinese('2026-03-15'),
      body: [{ level: 0, text: '要按照"预防为主、综合治理"的原则，坚持"安全第一"方针。' }],
    },
  });

  await test('无附件', {
    mode: 'official', style: 'standard', docType: 'tongzhi',
    outputPath: `${OUT}/无附件.docx`,
    content: {
      title: '关于做好节假日期间安全工作的通知',
      recipient: '各部门：',
      org: '办公室',
      date: dateToChinese('2026-03-15'),
      body: [{ level: 0, text: '节假日期间，请各部门做好安全防范工作。' }],
    },
  });

  await test('不传日期（默认今天）', {
    mode: 'official', style: 'standard', docType: 'tongzhi',
    outputPath: `${OUT}/默认日期.docx`,
    content: {
      title: '测试默认日期',
      recipient: '各部门：',
      org: '办公室',
      body: [{ level: 0, text: '测试不传日期时自动使用今天。' }],
    },
  });

  // 测试序号带顿号不重复
  await test('序号带顿号防重复', {
    mode: 'official', style: 'standard', docType: 'tongzhi',
    outputPath: `${OUT}/序号防重复.docx`,
    content: {
      title: '测试序号',
      recipient: '各部门：',
      org: '办公室',
      date: dateToChinese('2026-03-15'),
      body: [
        { level: 1, number: '一、', heading: '已带顿号的标题' },
        { level: 1, number: '二', heading: '不带顿号的标题' },
      ],
    },
  });

  // ══ 三、通用文档模式（general）══

  await test('工作总结', {
    mode: 'general',
    outputPath: `${OUT}/工作总结.docx`,
    content: {
      title : '2026年第一季度工作总结',
      author: '张三',
      org   : '某部门',
      date  : '2026年3月15日',
      body  : [
        { level: 0, text: '2026年第一季度，本人圆满完成了各项工作任务，现将主要情况总结如下。' },
        { level: 1, number: '一', heading: '主要工作完成情况' },
        { level: 2, number: '（一）', heading: '重点项目推进' },
        { level: 0, text: '按照年度工作计划，本季度共推进重点项目3个，均按期完成。' },
        { level: 2, number: '（二）', heading: '日常工作开展' },
        { level: 0, text: '认真完成各项日常工作，处理各类文件材料共计120余件。' },
        { level: 1, number: '二', heading: '存在的问题和不足' },
        { level: 0, text: '工作中也存在一些不足之处，统筹协调能力有待提升。' },
        { level: 1, number: '三', heading: '下一步工作计划' },
        { level: 0, text: '下一步将重点加强学习，提升业务能力，主动作为，提高工作效率。' },
      ],
    },
  });

  await test('项目方案', {
    mode: 'general',
    outputPath: `${OUT}/项目方案.docx`,
    content: {
      title: '数字化转型项目实施方案',
      org  : '信息技术部',
      date : '2026年3月15日',
      body : [
        { level: 0, text: '为推进公司数字化转型，提升整体运营效率，特制定本实施方案。' },
        { level: 1, number: '一', heading: '项目背景与目标' },
        { level: 0, text: '当前公司信息化水平参差不齐，数据孤岛现象严重，亟需统一规划推进数字化建设。' },
        { level: 2, number: '（一）', heading: '项目目标' },
        { level: 0, text: '实现核心业务系统全面上云，数据实时共享，业务流程自动化率达到80%以上。' },
        { level: 1, number: '二', heading: '实施计划' },
        { level: 3, number: '1.', heading: '第一阶段（1-3月）。', text: '需求调研与方案设计，完成需求文档和技术选型。' },
        { level: 3, number: '2.', heading: '第二阶段（4-8月）。', text: '系统开发与测试，完成核心模块开发和集成测试。' },
        { level: 3, number: '3.', heading: '第三阶段（9-12月）。', text: '上线部署与推广，完成全面上线和用户培训。' },
        { level: 1, number: '三', heading: '保障措施' },
        { level: 0, text: '成立项目推进领导小组，配备专职项目经理，确保项目按期推进。' },
      ],
      attachments: ['项目进度计划表', '预算明细表'],
    },
  });

  // ── 输出报告 ──
  console.log('\n═══════════════════════════════════════');
  console.log('           cn-docx 测试报告');
  console.log('═══════════════════════════════════════');

  const strictTests = results.filter(r => r.name.includes('strict') || r.name.includes('红头') || r.name.includes('签发'));
  const stdTests = results.filter(r => !strictTests.includes(r) && !['工作总结','项目方案'].includes(r.name));
  const generalTests  = results.filter(r => ['工作总结','项目方案'].includes(r.name));

  console.log('\n【公文模式 - standard】');
  stdTests.forEach(r => {
    if (r.status === '✅') console.log(`  ${r.status} ${r.name}  (${(r.size/1024).toFixed(1)}KB)`);
    else console.log(`  ${r.status} ${r.name}  错误：${r.error}`);
  });

  console.log('\n【公文模式 - strict (GB/T 9704-2012)】');
  strictTests.forEach(r => {
    if (r.status === '✅') console.log(`  ${r.status} ${r.name}  (${(r.size/1024).toFixed(1)}KB)`);
    else console.log(`  ${r.status} ${r.name}  错误：${r.error}`);
  });

  console.log('\n【通用文档模式】');
  generalTests.forEach(r => {
    if (r.status === '✅') console.log(`  ${r.status} ${r.name}  (${(r.size/1024).toFixed(1)}KB)`);
    else console.log(`  ${r.status} ${r.name}  错误：${r.error}`);
  });

  const passed = results.filter(r => r.status === '✅').length;
  console.log('\n───────────────────────────────────────');
  console.log(`总计：${passed}/${results.length} 通过`);
  console.log(`输出：${path.resolve(OUT)}`);
  console.log('═══════════════════════════════════════\n');
}

run().catch(e => { console.error('测试失败：', e.message); process.exit(1); });
