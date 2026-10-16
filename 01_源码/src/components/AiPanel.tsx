import { useEffect, useState } from 'react';
import { Sparkles, Settings2, X, Database, Send, LoaderCircle, Check } from 'lucide-react';
import type { AiContext, AiGroup, AiReply, AiSettings, Project } from '../domain/types';

const presets = [
  { name: 'OpenAI', url: 'https://api.openai.com/v1', hint: '填写账号可用的模型名称' },
  {
    name: 'DeepSeek',
    url: 'https://api.deepseek.com',
    hint: '例如 deepseek-flash（以服务商为准）',
  },
  { name: 'Ollama · 本机', url: 'http://127.0.0.1:11434/v1', hint: '填写已在本机下载的模型名称' },
];
type Message = { role: 'user' | 'assistant'; content: string };
function data<T>(r: { ok: boolean; data?: T; error?: string }): T {
  if (!r.ok) throw new Error(r.error ?? '操作失败');
  return r.data as T;
}

export function AiPanel({
  visible,
  project,
  parentId,
  ids,
  onClose,
  onAdopt,
}: {
  visible: boolean;
  project: Project;
  parentId: string | null;
  ids: string[];
  onClose(): void;
  onAdopt(groups: AiGroup[], scope: string[]): void;
}) {
  const [settings, setSettings] = useState<AiSettings | null>(null);
  const [configOpen, setConfigOpen] = useState(false);
  const [baseUrl, setBaseUrl] = useState('https://api.openai.com/v1');
  const [model, setModel] = useState('');
  const [key, setKey] = useState('');
  const [clearKey, setClearKey] = useState(false);
  const [custom, setCustom] = useState(false);
  const [question, setQuestion] = useState('这些文件分别是做什么的？请根据内容给出整理建议。');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [context, setContext] = useState<AiContext | null>(null);
  const [consent, setConsent] = useState(false);
  const [organize, setOrganize] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [reply, setReply] = useState<{ value: AiReply; ids: string[]; revision: string } | null>(
    null,
  );
  const [indexInfo, setIndexInfo] = useState('尚未建立项目索引；仍可读取所选文件片段。');
  function describeIndex(r: AiContext['index']) {
    return `已索引 ${r.files} 份文本 · ${r.chunks} 个片段 · 跳过 ${r.skipped} 项${r.truncated ? ' · 达到读取上限，部分内容未覆盖' : ''}。文件变化后请更新索引。`;
  }
  const scope = ids.slice(0, 100);
  const signature = JSON.stringify({ project, ids: scope, question });
  useEffect(() => {
    setContext(null);
    setConsent(false);
  }, [signature]);
  useEffect(() => {
    window.fileCanvas
      .aiSettings()
      .then((r) => {
        const s = data(r);
        setSettings(s);
        setBaseUrl(s.baseUrl);
        setModel(s.model);
        setConfigOpen(!s.model);
      })
      .catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    if (visible)
      window.fileCanvas
        .indexStatus()
        .then((r) => {
          if (r.ok && r.data?.builtAt) setIndexInfo(describeIndex(r.data));
        })
        .catch(() => {});
  }, [visible]);
  async function task(label: string, fn: () => Promise<void>) {
    if (busy) return;
    setBusy(label);
    setError('');
    setNotice('');
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy('');
    }
  }
  async function saveConfig() {
    const s = data(
      await window.fileCanvas.saveAiSettings({
        baseUrl,
        model,
        apiKey: clearKey ? '' : key || undefined,
      }),
    );
    setSettings(s);
    setKey('');
    setClearKey(false);
    setContext(null);
    setConsent(false);
  }
  function prepare(mode: boolean) {
    void task('正在准备本地资料…', async () => {
      if (!question.trim()) throw new Error('请先填写问题或整理目标。');
      const analyzeIds = mode
        ? scope.filter(
            (id) => project.nodes[id]?.kind === 'file' && project.nodes[id].parentId === parentId,
          )
        : scope;
      if (mode && !analyzeIds.length)
        throw new Error('当前目录没有可分类的文件，请进入文件夹后再整理。');
      const c = data(await window.fileCanvas.prepareAi(project, analyzeIds, question));
      setContext(c);
      setOrganize(mode);
      setConsent(false);
    });
  }
  const activePreset = presets.find((p) => p.url === baseUrl);
  const modelChoices =
    activePreset?.name === 'DeepSeek'
      ? ['deepseek-flash', 'deepseek-v4-pro']
      : activePreset?.name === 'OpenAI'
        ? ['gpt-6-luna', 'gpt-6-sol', 'gpt-6-astra']
        : [];
  return (
    <aside className="ai-panel" aria-label="AI 文件助手" hidden={!visible}>
      <div className="drawer-title">
        <span>
          <Sparkles size={17} />
          AI 文件助手
        </span>
        <div>
          <button
            className="icon-button"
            title="模型设置"
            onClick={() => setConfigOpen(!configOpen)}
          >
            <Settings2 size={17} />
          </button>
          <button className="icon-button" title="收起 AI 助手" onClick={onClose}>
            <X size={17} />
          </button>
        </div>
      </div>
      <div className="ai-scroll">
        <div className="ai-model-line">
          <span className="connection-dot" />
          {settings?.model || '尚未配置模型'}
          <button className="text-button" onClick={() => setConfigOpen(!configOpen)}>
            配置模型
          </button>
        </div>
        {configOpen && (
          <form
            className="ai-settings"
            onSubmit={(e) => {
              e.preventDefault();
              void task('正在保存…', async () => {
                await saveConfig();
                setNotice('模型配置已保存。');
              });
            }}
          >
            <label>
              常用服务
              <select
                aria-label="常用 AI 服务"
                value={custom ? '自定义' : (activePreset?.name ?? '自定义')}
                onChange={(e) => {
                  setCustom(e.target.value === '自定义');
                  const p = presets.find((p) => p.name === e.target.value);
                  if (p) {
                    setBaseUrl(p.url);
                    setModel(p.name === 'DeepSeek' ? 'deepseek-flash' : '');
                    setKey('');
                  }
                }}
              >
                <option value="自定义">自定义兼容接口</option>
                {presets.map((p) => (
                  <option key={p.name}>{p.name}</option>
                ))}
              </select>
            </label>
            <label>
              服务地址（可编辑）
              <input
                aria-label="AI 服务地址"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                required
              />
            </label>
            <label>
              模型名称（可选，也可编辑）
              <input
                aria-label="AI 模型名称"
                list="ai-model-choices"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder={activePreset?.hint ?? '服务商提供的模型名称'}
                required
              />
              <datalist id="ai-model-choices">
                {modelChoices.map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
            </label>
            <label>
              API 密钥
              <input
                aria-label="AI API 密钥"
                type="password"
                autoComplete="off"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder={
                  settings?.hasKey ? '已加密保存；留空保留原密钥' : '本机 Ollama 通常可留空'
                }
              />
            </label>
            {settings?.hasKey && (
              <label className="check-line">
                <input
                  type="checkbox"
                  checked={clearKey}
                  onChange={(e) => setClearKey(e.target.checked)}
                />
                清除已保存密钥
              </label>
            )}
            <small>切换服务地址时不会沿用原密钥。测试连接会调用模型，仅发送测试语句。</small>
            <div className="ai-actions">
              <button className="button" type="submit" disabled={!!busy}>
                保存配置
              </button>
              <button
                className="button"
                type="button"
                disabled={!!busy || !model.trim()}
                onClick={() =>
                  void task('正在测试模型…', async () => {
                    await saveConfig();
                    setNotice(data(await window.fileCanvas.testAi()));
                  })
                }
              >
                保存并测试连接
              </button>
            </div>
          </form>
        )}
        <div className="index-card">
          <div>
            <Database size={17} />
            <strong>项目知识</strong>
            <button
              className="text-button"
              disabled={!!busy}
              onClick={() =>
                void task('正在建立本地索引…', async () => {
                  const r = data(await window.fileCanvas.buildIndex());
                  setContext(null);
                  setIndexInfo(describeIndex(r));
                })
              }
            >
              建立 / 更新索引
            </button>
          </div>
          <p>{indexInfo}</p>
          <small>
            仅当前项目，索引保留在本次运行内；排除隐藏项、常见密钥文件与构建目录。检索使用关键词，正文最多发送
            8 段。
          </small>
        </div>
        {!messages.length && (
          <div className="ai-intro">
            <Sparkles size={26} />
            <h3>先看内容，再决定怎么放</h3>
            <p>问文件用途、寻找相关资料，或者让 AI 按你的目标提出分类。描述目标会让建议更准确。</p>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`ai-message ${m.role}`}>
            <small>{m.role === 'user' ? '你' : 'AI 助手'}</small>
            <p>{m.content}</p>
          </div>
        ))}
        {reply?.value.groups.length ? (
          <div className="ai-plan">
            <h3>整理草案 · {reply.value.groups.length} 类</h3>
            {reply.value.groups.map((g) => (
              <div key={g.folder}>
                <strong>
                  {g.folder} · {g.ids.length} 个文件
                </strong>
                <p>{g.reason}</p>
                <small>
                  {g.ids.map((id) => project.nodes[id]?.name ?? '文件已变化').join('、')}
                </small>
              </div>
            ))}
            <button
              className="button primary"
              disabled={!!busy || reply.revision !== JSON.stringify(project)}
              onClick={() => {
                onAdopt(reply.value.groups, reply.ids);
              }}
            >
              采用到画布（可撤销）
            </button>
            {reply.revision !== JSON.stringify(project) && <p>画布已变化，请重新生成草案。</p>}
            <small>采用仅修改虚拟结构，原文件保持原位。</small>
          </div>
        ) : null}
        {context && (
          <div className="context-preview">
            <h3>将发送哪些资料？</h3>
            <p>
              {context.manifest.length} 项文件信息 · {context.sources.length} 段正文 · 最近{' '}
              {Math.min(messages.length, 6)} 条对话
            </p>
            <small>有 {context.omitted} 个范围内文件未提供正文。AI 对它们只能按名称推测。</small>
            <details>
              <summary>查看文件清单与正文片段</summary>
              <pre>{context.manifest.map((m) => m.path).join('\n')}</pre>
              {context.sources.map((s, i) => (
                <div key={i}>
                  <strong>{s.path}</strong>
                  <pre>{s.text}</pre>
                </div>
              ))}
            </details>
            <label className="check-line">
              <input
                type="checkbox"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
              />
              允许发送以上资料到已配置的模型服务
            </label>
            <button
              className="button primary"
              disabled={!consent || !!busy}
              onClick={() =>
                void task('AI 正在分析…', async () => {
                  const contextIds = context.manifest.map((m) => m.id);
                  const r = data(
                    await window.fileCanvas.askAi(
                      project,
                      contextIds,
                      question,
                      organize,
                      context,
                      messages,
                    ),
                  );
                  setMessages((old) => [
                    ...old,
                    { role: 'user', content: question },
                    { role: 'assistant', content: r.answer },
                  ]);
                  setReply({ value: r, ids: contextIds, revision: JSON.stringify(project) });
                  setContext(null);
                  setConsent(false);
                })
              }
            >
              <Send size={15} />
              {organize ? '发送并生成整理草案' : '发送问题'}
            </button>
          </div>
        )}
        {notice && (
          <p className="ai-notice" role="status">
            <Check size={14} />
            {notice}
          </p>
        )}
        {error && (
          <p className="inline-error" role="alert">
            {error}
          </p>
        )}
      </div>
      <div className="ai-composer">
        <small>
          分析范围：{ids.length > 100 ? '前 100 项（已截断）' : `${scope.length} 项`} ·{' '}
          {scope.length ? '选中项优先，否则当前目录' : '可建立索引后查询项目资料'}
        </small>
        <textarea
          aria-label="问 AI 或描述整理目标"
          maxLength={4000}
          rows={3}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="例如：我要交付这次拍摄，哪些是最终稿？"
        />
        <div className="ai-actions">
          <button
            className="button"
            disabled={!!busy || !settings?.model}
            onClick={() => prepare(false)}
          >
            问文件 / 查资料
          </button>
          <button
            className="button primary"
            disabled={!!busy || !settings?.model || !scope.length}
            onClick={() => prepare(true)}
          >
            <Sparkles size={14} />
            AI 整理
          </button>
        </div>
        {busy && (
          <p className="ai-working">
            <LoaderCircle size={14} className="spin" />
            {busy}
          </p>
        )}
      </div>
    </aside>
  );
}
