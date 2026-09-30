import fs from 'node:fs';
import path from 'node:path';

const directory = path.resolve('workflows');
const files = fs.readdirSync(directory).filter((name) => name.startsWith('kulon-') && name.endsWith('.json'));
if (!files.length) throw new Error('没有找到 KULON n8n 工作流');
for (const file of files) {
  const workflow = JSON.parse(fs.readFileSync(path.join(directory, file), 'utf8'));
  if (!workflow.name || !Array.isArray(workflow.nodes) || !workflow.connections) {
    throw new Error(`${file} 缺少 name、nodes 或 connections`);
  }
  const names = new Set(workflow.nodes.map((node) => node.name));
  const nodesByName = new Map(workflow.nodes.map((node) => [node.name, node]));
  if (workflow.active) throw new Error(`${file} 必须默认保持未激活`);
  for (const [source, outputs] of Object.entries(workflow.connections)) {
    if (!names.has(source)) throw new Error(`${file} 连接源节点不存在: ${source}`);
    for (const channels of Object.values(outputs)) {
      for (const channel of channels) {
        for (const target of channel) {
          if (!names.has(target.node)) throw new Error(`${file} 连接目标节点不存在: ${target.node}`);
          const targetNode = nodesByName.get(target.node);
          if (target.index !== 0 && targetNode.type !== 'n8n-nodes-base.merge') {
            throw new Error(`${file} 连接到不存在的输入口: ${target.node}[${target.index}]`);
          }
        }
      }
    }
  }
  for (const node of workflow.nodes) {
    const headers = node.parameters?.headerParameters?.parameters || [];
    for (const header of headers) {
      if (header.name === 'Authorization' && !String(header.value).includes('$vars.AUTOMATION_TOKEN')) {
        throw new Error(`${file} 源工作流不得内嵌 AUTOMATION_TOKEN: ${node.name}`);
      }
    }
  }
  console.log(`${file}: ${workflow.nodes.length} nodes OK`);
}
