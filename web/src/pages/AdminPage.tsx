import React, { useState, useEffect } from 'react';
import {
  adminLogin,
  adminLogout,
  createAdminNode,
  updateAdminNode,
  deleteAdminNode,
  rotateAdminNodeToken,
  fetchNodeConfig,
  updateNodeConfig,
  fetchAlertRules,
  fetchAlertRuleDetails,
  createAlertRule,
  updateAlertRule,
  deleteAlertRule,
  testAlertWebhook,
  fetchSystemEvents,
  PROBE_PRESETS,
  NodeServerConfig,
  ProbeConfig,
  AlertRule,
  SystemEvent,
} from '../api/client';
import { useAdminSessionQuery, useAdminNodesQuery } from '../queries/nodes';
import { useTranslation } from '../i18n/I18nContext';
import { formatBeijingDate } from '../utils/time';

export const AdminPage: React.FC = () => {
  const { data: sessionData, refetch: refetchSession } = useAdminSessionQuery();
  const authenticated = sessionData?.authenticated || false;
  const { t } = useTranslation();

  const { data: nodesData, refetch: refetchNodes } = useAdminNodesQuery(authenticated);

  const [adminKey, setAdminKey] = useState('');
  const [loggingIn, setLoggingIn] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<'nodes' | 'alerts' | 'events'>('nodes');
  const [alertRules, setAlertRules] = useState<AlertRule[]>([]);
  const [loadingAlerts, setLoadingAlerts] = useState(false);
  const [systemEvents, setSystemEvents] = useState<SystemEvent[]>([]);
  const [loadingEvents, setLoadingEvents] = useState(false);

  // Channel Modal State (Add & Edit)
  const [showAddChannelModal, setShowAddChannelModal] = useState(false);
  const [editingChannel, setEditingChannel] = useState<AlertRule | null>(null);
  const [newChannelName, setNewChannelName] = useState('');
  const [newAlertChannel, setNewAlertChannel] = useState<
    'telegram' | 'discord' | 'feishu' | 'dingtalk' | 'wecom' | 'bark' | 'serverchan' | 'pushdeer' | 'slack' | 'custom'
  >('telegram');
  const [newAlertWebhookUrl, setNewAlertWebhookUrl] = useState('');
  const [newAlertBotToken, setNewAlertBotToken] = useState('');
  const [newAlertChatId, setNewAlertChatId] = useState('');
  const [newAlertApiHost, setNewAlertApiHost] = useState('');
  const [newAlertMethod, setNewAlertMethod] = useState<'POST' | 'GET'>('POST');
  const [newAlertContentType, setNewAlertContentType] = useState<'json' | 'form' | 'text'>('json');
  const [newAlertUrlTemplate, setNewAlertUrlTemplate] = useState('');
  const [newAlertBodyTemplate, setNewAlertBodyTemplate] = useState('');
  const [newAlertHeaders, setNewAlertHeaders] = useState('');
  const [testingAlert, setTestingAlert] = useState(false);
  const [testFeedback, setTestFeedback] = useState<{ success: boolean; message: string } | null>(null);

  // Alert Rule Modal State (Add & Edit, Multi-Condition Support)
  const [showAddRuleModal, setShowAddRuleModal] = useState(false);
  const [editingPolicy, setEditingPolicy] = useState<AlertRule | null>(null);
  const [newRuleName, setNewRuleName] = useState('');
  const [condOfflineEnabled, setCondOfflineEnabled] = useState(true);
  const [condOfflineDurationSec, setCondOfflineDurationSec] = useState(90);
  const [condCpuEnabled, setCondCpuEnabled] = useState(true);
  const [condCpuThreshold, setCondCpuThreshold] = useState(85);
  const [condCpuDurationSec, setCondCpuDurationSec] = useState(60);
  const [condMemoryEnabled, setCondMemoryEnabled] = useState(true);
  const [condMemoryThreshold, setCondMemoryThreshold] = useState(90);
  const [condMemoryDurationSec, setCondMemoryDurationSec] = useState(60);
  const [condDiskEnabled, setCondDiskEnabled] = useState(true);
  const [condDiskThreshold, setCondDiskThreshold] = useState(90);
  const [condExpiryEnabled, setCondExpiryEnabled] = useState(false);
  const [condExpiryDays, setCondExpiryDays] = useState(7);
  const [newRuleChannelIds, setNewRuleChannelIds] = useState<number[]>([]);
  const [creatingAlert, setCreatingAlert] = useState(false);

  const [showAddModal, setShowAddModal] = useState(false);
  const [newNodeName, setNewNodeName] = useState('');
  const [newNodeResetDay, setNewNodeResetDay] = useState(1);
  const [newNodeQuotaGb, setNewNodeQuotaGb] = useState('');
  const [newNodePrice, setNewNodePrice] = useState('');
  const [newNodeCurrency, setNewNodeCurrency] = useState('USD');
  const [newNodeCycle, setNewNodeCycle] = useState('monthly');
  const [newNodeAutoRenewal, setNewNodeAutoRenewal] = useState(false);
  const [newNodeExpiresAt, setNewNodeExpiresAt] = useState('');
  const [newNodeNote, setNewNodeNote] = useState('');
  const [newNodeSampleInterval, setNewNodeSampleInterval] = useState(2);
  const [newNodeStreamInterval, setNewNodeStreamInterval] = useState(2);
  const [newNodeProbeInterval, setNewNodeProbeInterval] = useState(60);
  const [newNodeNetIface, setNewNodeNetIface] = useState('auto');

  const [editingNode, setEditingNode] = useState<any | null>(null);
  const [updatingNode, setUpdatingNode] = useState(false);
  const [oneTimeTokenModal, setOneTimeTokenModal] = useState<{
    nodeId: string;
    rawToken: string;
    warning?: string;
  } | null>(null);
  const [adminBannerWarning, setAdminBannerWarning] = useState<string | null>(null);
  const [cmdTab, setCmdTab] = useState<'linux_install' | 'linux_binary' | 'windows_ps' | 'windows_cmd' | 'systemd' | 'raw'>('linux_install');
  const [copyFeedback, setCopyFeedback] = useState(false);

  const [editingConfig, setEditingConfig] = useState<NodeServerConfig | null>(null);
  const [newProbeId, setNewProbeId] = useState('');
  const [newProbeTarget, setNewProbeTarget] = useState('');
  const [newProbeProtocol, setNewProbeProtocol] = useState<'icmp' | 'tcp'>('icmp');
  const [newProbePort, setNewProbePort] = useState<number>(80);

  function handleApplyPreset(preset: keyof typeof PROBE_PRESETS) {
    if (!editingConfig) return;
    setEditingConfig({
      ...editingConfig,
      probes: [...PROBE_PRESETS[preset]],
    });
  }

  function handleAddProbe() {
    if (!newProbeId || !newProbeTarget || !editingConfig) return;
    const newProbe: ProbeConfig = {
      id: newProbeId.trim(),
      target: newProbeTarget.trim(),
      protocol: newProbeProtocol,
      port: newProbeProtocol === 'tcp' ? newProbePort : undefined,
    };
    setEditingConfig({
      ...editingConfig,
      probes: [...(editingConfig.probes || []), newProbe],
    });
    setNewProbeId('');
    setNewProbeTarget('');
  }

  function handleRemoveProbe(idx: number) {
    if (!editingConfig || !editingConfig.probes) return;
    const updated = [...editingConfig.probes];
    updated.splice(idx, 1);
    setEditingConfig({
      ...editingConfig,
      probes: updated,
    });
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoggingIn(true);
    setLoginError(null);
    try {
      await adminLogin(adminKey);
      setAdminKey('');
      await refetchSession();
      refetchNodes();
    } catch (err: any) {
      setLoginError(err.message || 'Authentication rejected');
    } finally {
      setLoggingIn(false);
    }
  }

  async function handleLogout() {
    await adminLogout();
    refetchSession();
  }

  async function loadAlertRules() {
    setLoadingAlerts(true);
    try {
      const res = await fetchAlertRules();
      setAlertRules(res.rules || []);
    } catch (err: any) {
      console.error('Failed to load alert rules:', err);
    } finally {
      setLoadingAlerts(false);
    }
  }

  async function loadSystemEvents() {
    setLoadingEvents(true);
    try {
      const res = await fetchSystemEvents();
      setSystemEvents(res.events || []);
    } catch (err: any) {
      console.error('Failed to load system events:', err);
    } finally {
      setLoadingEvents(false);
    }
  }

  useEffect(() => {
    if (authenticated) {
      if (activeTab === 'alerts') {
        loadAlertRules();
      } else if (activeTab === 'events') {
        loadSystemEvents();
      }
    }
  }, [authenticated, activeTab]);

  async function handleTestAlert() {
    setTestingAlert(true);
    setTestFeedback(null);
    try {
      let headersObj: Record<string, string> | undefined = undefined;
      if (newAlertHeaders.trim()) {
        try {
          headersObj = JSON.parse(newAlertHeaders.trim());
        } catch {
          setTestFeedback({ success: false, message: '自定义 Headers 必须是合法的 JSON 格式' });
          return;
        }
      }

      const res = await testAlertWebhook({
        channel: newAlertChannel,
        webhook_url: newAlertWebhookUrl.trim() || undefined,
        bot_token: newAlertBotToken.trim() || undefined,
        chat_id: newAlertChatId.trim() || undefined,
        api_host: newAlertApiHost.trim() || undefined,
        method: newAlertMethod,
        headers: headersObj,
        url_template: newAlertUrlTemplate.trim() || undefined,
        body_template: newAlertBodyTemplate.trim() || undefined,
        content_type: newAlertContentType,
      });

      if (res.success) {
        setTestFeedback({
          success: true,
          message: `✅ 测试通知发送成功！目标平台已确认接收 (HTTP ${res.status || 200})`,
        });
      } else {
        setTestFeedback({
          success: false,
          message: `❌ 测试发送失败: ${res.error || '未知错误'}`,
        });
      }
    } catch (err: any) {
      setTestFeedback({
        success: false,
        message: `❌ 测试发送失败: ${err.message || '网络请求异常'}`,
      });
    } finally {
      setTestingAlert(false);
    }
  }

  function openAddChannelModal() {
    setEditingChannel(null);
    setNewChannelName('');
    setNewAlertChannel('telegram');
    setNewAlertWebhookUrl('');
    setNewAlertBotToken('');
    setNewAlertChatId('');
    setNewAlertApiHost('');
    setNewAlertMethod('POST');
    setNewAlertContentType('json');
    setNewAlertUrlTemplate('');
    setNewAlertBodyTemplate('');
    setNewAlertHeaders('');
    setTestFeedback(null);
    setShowAddChannelModal(true);
  }

  async function openEditChannelModal(channel: AlertRule) {
    setEditingChannel(channel);
    setTestFeedback(null);
    setShowAddChannelModal(true);
    try {
      const res = await fetchAlertRuleDetails(channel.id);
      const cfg = res.decryptedConfig || res.parsedConfig || {};
      setNewChannelName(cfg.name || '');
      setNewAlertChannel(cfg.channel || 'telegram');
      setNewAlertWebhookUrl(cfg.webhook_url || '');
      setNewAlertBotToken(cfg.bot_token || '');
      setNewAlertChatId(cfg.chat_id || '');
      setNewAlertApiHost(cfg.api_host || '');
      setNewAlertMethod(cfg.method || 'POST');
      setNewAlertHeaders(cfg.headers ? JSON.stringify(cfg.headers, null, 2) : '');
      setNewAlertUrlTemplate(cfg.url_template || '');
      setNewAlertBodyTemplate(cfg.body_template || '');
      setNewAlertContentType(cfg.content_type || 'json');
    } catch (err: any) {
      console.error('Failed to load channel details:', err);
    }
  }

  function openAddPolicyModal() {
    setEditingPolicy(null);
    setNewRuleName('');
    setNewRuleChannelIds([]);
    setCondOfflineEnabled(true);
    setCondOfflineDurationSec(90);
    setCondCpuEnabled(true);
    setCondCpuThreshold(85);
    setCondCpuDurationSec(60);
    setCondMemoryEnabled(true);
    setCondMemoryThreshold(90);
    setCondMemoryDurationSec(60);
    setCondDiskEnabled(true);
    setCondDiskThreshold(90);
    setCondExpiryEnabled(false);
    setCondExpiryDays(7);
    setShowAddRuleModal(true);
  }

  function openEditPolicyModal(rule: AlertRule) {
    setEditingPolicy(rule);
    let parsedConfig: any = {};
    try {
      parsedConfig = rule.config_json ? JSON.parse(rule.config_json) : {};
    } catch {}
    setNewRuleName(parsedConfig.name || '');
    setNewRuleChannelIds(parsedConfig.channel_ids || []);
    const conds = parsedConfig.conditions || {};
    setCondOfflineEnabled(Boolean(conds.offline?.enabled ?? (rule.type === 'offline')));
    setCondOfflineDurationSec(conds.offline?.duration_sec ?? rule.duration_sec ?? 90);
    setCondCpuEnabled(Boolean(conds.cpu?.enabled ?? (rule.type === 'cpu')));
    setCondCpuThreshold(conds.cpu?.threshold ?? (rule.type === 'cpu' ? rule.threshold ?? 85 : 85));
    setCondCpuDurationSec(conds.cpu?.duration_sec ?? (rule.type === 'cpu' ? rule.duration_sec ?? 60 : 60));
    setCondMemoryEnabled(Boolean(conds.memory?.enabled ?? (rule.type === 'memory')));
    setCondMemoryThreshold(conds.memory?.threshold ?? (rule.type === 'memory' ? rule.threshold ?? 90 : 90));
    setCondMemoryDurationSec(conds.memory?.duration_sec ?? (rule.type === 'memory' ? rule.duration_sec ?? 60 : 60));
    setCondDiskEnabled(Boolean(conds.disk?.enabled ?? (rule.type === 'disk')));
    setCondDiskThreshold(conds.disk?.threshold ?? (rule.type === 'disk' ? rule.threshold ?? 90 : 90));
    setCondExpiryEnabled(Boolean(conds.expiry?.enabled ?? (rule.type === 'expiry')));
    setCondExpiryDays(conds.expiry?.days ?? 7);
    setShowAddRuleModal(true);
  }

  async function handleSaveChannel(e: React.FormEvent) {
    e.preventDefault();
    setCreatingAlert(true);
    try {
      if (!newChannelName.trim()) {
        alert(t('channel_name') + ' required');
        return;
      }
      if (newAlertChannel === 'telegram') {
        if (!newAlertBotToken || !newAlertChatId) {
          alert('Telegram Bot Token & Chat ID required');
          return;
        }
      } else if (newAlertChannel !== 'custom' && !newAlertWebhookUrl) {
        alert('Webhook URL required');
        return;
      }

      let headersObj: Record<string, string> | undefined = undefined;
      if (newAlertHeaders.trim()) {
        try {
          headersObj = JSON.parse(newAlertHeaders.trim());
        } catch {
          alert('Headers JSON format error');
          return;
        }
      }

      const config = {
        name: newChannelName.trim(),
        channel: newAlertChannel,
        webhook_url: newAlertWebhookUrl.trim() || undefined,
        bot_token: newAlertBotToken.trim() || undefined,
        chat_id: newAlertChatId.trim() || undefined,
        api_host: newAlertApiHost.trim() || undefined,
        method: newAlertMethod,
        headers: headersObj,
        url_template: newAlertUrlTemplate.trim() || undefined,
        body_template: newAlertBodyTemplate.trim() || undefined,
        content_type: newAlertContentType,
      };

      if (editingChannel) {
        await updateAlertRule(editingChannel.id, {
          type: 'channel',
          enabled: 1,
          config,
        });
      } else {
        await createAlertRule({
          type: 'channel',
          enabled: 1,
          config,
        });
      }

      setShowAddChannelModal(false);
      setEditingChannel(null);
      setTestFeedback(null);
      loadAlertRules();
    } catch (err: any) {
      alert(err.message || 'Failed to save notification channel');
    } finally {
      setCreatingAlert(false);
    }
  }

  async function handleSavePolicy(e: React.FormEvent) {
    e.preventDefault();
    setCreatingAlert(true);
    try {
      const conditions = {
        offline: { enabled: condOfflineEnabled, duration_sec: condOfflineDurationSec },
        cpu: { enabled: condCpuEnabled, threshold: condCpuThreshold, duration_sec: condCpuDurationSec },
        memory: { enabled: condMemoryEnabled, threshold: condMemoryThreshold, duration_sec: condMemoryDurationSec },
        disk: { enabled: condDiskEnabled, threshold: condDiskThreshold },
        expiry: { enabled: condExpiryEnabled, days: condExpiryDays },
      };

      const hasAnyEnabled = Object.values(conditions).some((c: any) => c.enabled);
      if (!hasAnyEnabled) {
        alert(t('policy_conditions_heading') + ' required');
        return;
      }

      const config = {
        name: newRuleName.trim() || '综合告警策略',
        channel_ids: newRuleChannelIds,
        conditions,
      };

      if (editingPolicy) {
        await updateAlertRule(editingPolicy.id, {
          type: 'policy',
          enabled: 1,
          config,
        });
      } else {
        await createAlertRule({
          type: 'policy',
          enabled: 1,
          config,
        });
      }

      setShowAddRuleModal(false);
      setEditingPolicy(null);
      loadAlertRules();
    } catch (err: any) {
      alert(err.message || 'Failed to save alert rule');
    } finally {
      setCreatingAlert(false);
    }
  }

  async function handleDeleteAlert(id: number) {
    if (!confirm('DELETE ALERT RULE / WEBHOOK DESTINATION?')) return;
    try {
      await deleteAlertRule(id);
      loadAlertRules();
    } catch (err: any) {
      alert(err.message || 'Failed to delete alert rule');
    }
  }

  async function handleCreateNode(e: React.FormEvent) {
    e.preventDefault();
    try {
      const quotaBytes = newNodeQuotaGb ? parseFloat(newNodeQuotaGb) * 1024 * 1024 * 1024 : null;
      const expiresAtMs = newNodeExpiresAt ? new Date(newNodeExpiresAt).getTime() : null;
      const priceNum = newNodePrice !== '' ? parseFloat(newNodePrice) : null;

      const res = await createAdminNode({
        name: newNodeName,
        traffic_reset_day: newNodeResetDay,
        traffic_quota_bytes: quotaBytes,
        expires_at_ms: expiresAtMs,
        note: newNodeNote || null,
        plan_price: priceNum,
        plan_currency: newNodeCurrency,
        billing_cycle: newNodeCycle,
        auto_renewal: newNodeAutoRenewal,
        sample_interval_sec: newNodeSampleInterval || 2,
        stream_interval_sec: newNodeStreamInterval || 2,
        probe_interval_sec: newNodeProbeInterval || 60,
        network_interface: newNodeNetIface.trim() || 'auto',
      });
      setShowAddModal(false);
      setNewNodeName('');
      setNewNodeQuotaGb('');
      setNewNodeExpiresAt('');
      setNewNodeNote('');
      setNewNodePrice('');
      setNewNodeCurrency('USD');
      setNewNodeCycle('monthly');
      setNewNodeAutoRenewal(true);
      setNewNodeSampleInterval(2);
      setNewNodeStreamInterval(2);
      setNewNodeProbeInterval(60);
      setNewNodeNetIface('auto');
      setOneTimeTokenModal({
        nodeId: res.node.id,
        rawToken: res.rawToken,
      });
      refetchNodes();
    } catch (err: any) {
      alert(err.message);
    }
  }

  async function openEditModal(n: any) {
    let quotaGbStr = '';
    if (n.traffic_quota_bytes && n.traffic_quota_bytes > 0) {
      quotaGbStr = String(Math.round(n.traffic_quota_bytes / (1024 * 1024 * 1024)));
    }
    let expiresAtStr = '';
    if (n.expires_at_ms) {
      const d = new Date(n.expires_at_ms);
      expiresAtStr = d.toISOString().split('T')[0];
    }
    setEditingNode({
      id: n.id,
      name: n.name,
      traffic_reset_day: n.traffic_reset_day || 1,
      traffic_quota_gb: quotaGbStr,
      expires_at: expiresAtStr,
      note: n.note || '',
      hidden: Boolean(n.hidden),
      plan_price: n.plan_price != null ? String(n.plan_price) : '',
      plan_currency: n.plan_currency || 'USD',
      billing_cycle: n.billing_cycle || 'monthly',
      auto_renewal: Boolean(n.auto_renewal ?? 1),
    });

    try {
      const res = await fetchNodeConfig(n.id);
      setEditingConfig({
        sample_interval_sec: res.config?.sample_interval_sec ?? 2,
        stream_interval_sec: res.config?.stream_interval_sec ?? 2,
        probe_interval_sec: res.config?.probe_interval_sec ?? 60,
        network_interface: res.config?.network_interface ?? 'auto',
        probes: Array.isArray(res.config?.probes) && res.config.probes.length > 0 ? res.config.probes : PROBE_PRESETS.china_3net,
        alert_policy: res.config?.alert_policy ?? { mode: 'global' },
      });
    } catch {
      setEditingConfig({
        sample_interval_sec: 2,
        stream_interval_sec: 2,
        probe_interval_sec: 60,
        network_interface: 'auto',
        probes: PROBE_PRESETS.china_3net,
        alert_policy: { mode: 'global' },
      });
    }
  }

  async function handleUpdateNode(e: React.FormEvent) {
    e.preventDefault();
    if (!editingNode) return;
    setUpdatingNode(true);
    try {
      const quotaBytes = editingNode.traffic_quota_gb
        ? parseFloat(editingNode.traffic_quota_gb) * 1024 * 1024 * 1024
        : null;
      const expiresAtMs = editingNode.expires_at
        ? new Date(editingNode.expires_at).getTime()
        : null;
      const priceNum = editingNode.plan_price !== '' ? parseFloat(editingNode.plan_price) : null;

      // 1. Update node basic & billing attributes
      await updateAdminNode(editingNode.id, {
        name: editingNode.name,
        traffic_reset_day: editingNode.traffic_reset_day,
        traffic_quota_bytes: quotaBytes,
        expires_at_ms: expiresAtMs,
        note: editingNode.note || null,
        hidden: editingNode.hidden,
        plan_price: priceNum,
        plan_currency: editingNode.plan_currency,
        billing_cycle: editingNode.billing_cycle,
        auto_renewal: editingNode.auto_renewal,
      });

      // 2. Update probe config & alert policy if available
      if (editingConfig) {
        await updateNodeConfig(editingNode.id, editingConfig);
      }

      setEditingNode(null);
      setEditingConfig(null);
      refetchNodes();
    } catch (err: any) {
      alert(`更新失败: ${err.message}`);
    } finally {
      setUpdatingNode(false);
    }
  }

  async function handleRotateToken(nodeId: string) {
    if (!confirm('ROTATE AUTHENTICATION TOKEN? The existing token will be immediately invalidated.')) {
      return;
    }
    try {
      const res = await rotateAdminNodeToken(nodeId);
      setOneTimeTokenModal({
        nodeId,
        rawToken: res.rawToken,
        warning: res.warning,
      });
      if (res.warning) {
        setAdminBannerWarning(`[${nodeId}] Token rotated in database, but active stream disconnect RPC timed out (${res.warning}). Active socket will be invalidated on next verification or within 60s.`);
      }
    } catch (err: any) {
      alert(err.message);
    }
  }

  async function handleDeleteNode(nodeId: string) {
    if (!confirm('DECOMMISSION NODE? All historical telemetry will be permanently wiped.')) {
      return;
    }
    try {
      const res = await deleteAdminNode(nodeId);
      if (res.warning) {
        setAdminBannerWarning(`[${nodeId}] Node deleted from database, but active stream disconnect RPC timed out (${res.warning}). Active socket will be invalidated on next verification.`);
      }
      refetchNodes();
    } catch (err: any) {
      alert(err.message);
    }
  }

  const adminNodes = nodesData?.nodes || [];

  return (
    <div className="page-container">
      {adminBannerWarning && (
        <div className="detail-chassis-band" style={{ marginBottom: '24px', borderColor: '#e22718', backgroundColor: 'rgba(226, 39, 24, 0.08)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ color: '#e22718', fontSize: '12px', fontWeight: 600 }}>{adminBannerWarning}</span>
            <button
              style={{ background: 'none', border: 'none', color: '#ffffff', cursor: 'pointer' }}
              onClick={() => setAdminBannerWarning(null)}
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {!authenticated ? (
        <div style={{ maxWidth: '440px', margin: '80px auto', width: '100%' }}>
          <div className="detail-chassis-band" style={{ padding: '36px 32px' }}>
            <span className="eyebrow-cap" style={{ fontSize: '11px', color: 'var(--colors-m-blue-light)' }}>
              EDGEMON // ADMIN GATEWAY
            </span>
            <h2 className="display-lg" style={{ fontSize: '22px', marginTop: '6px', marginBottom: '8px' }}>
              {t('nav_console')}
            </h2>
            <p className="caption" style={{ marginBottom: '24px' }}>
              {t('admin_login_sub')}
            </p>

            <form onSubmit={handleLogin}>
              <div style={{ marginBottom: '20px' }}>
                <span className="eyebrow-cap" style={{ display: 'block', marginBottom: '8px', fontSize: '11px' }}>
                  {t('admin_key_label')}
                </span>
                <input
                  value={adminKey}
                  onChange={(e) => setAdminKey(e.target.value)}
                  type="password"
                  placeholder="ADMIN_KEY..."
                  className="spacex-input"
                  required
                  autoFocus
                />
              </div>

              {loginError && (
                <p className="caption" style={{ color: 'var(--colors-status-alert)', marginBottom: '16px', fontWeight: 600 }}>
                  ⚠️ {loginError.toUpperCase()}
                </p>
              )}

              <button type="submit" className="button-ghost-on-dark" style={{ width: '100%', height: '42px' }} disabled={loggingIn}>
                {loggingIn ? '...' : t('admin_login_btn')}
              </button>
            </form>
          </div>
        </div>
      ) : (
        <div>
          {/* Admin Section Title Bar & Sub-Tabs */}
          <div className="section-title-bar" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
              <div className="range-capsules" style={{ margin: 0 }}>
                <button
                  type="button"
                  className={`range-capsule-btn ${activeTab === 'nodes' ? 'active' : ''}`}
                  onClick={() => setActiveTab('nodes')}
                >
                  {t('tab_nodes')} ({adminNodes.length})
                </button>
                <button
                  type="button"
                  className={`range-capsule-btn ${activeTab === 'alerts' ? 'active' : ''}`}
                  onClick={() => setActiveTab('alerts')}
                >
                  {t('tab_alerts')} ({alertRules.length})
                </button>
                <button
                  type="button"
                  className={`range-capsule-btn ${activeTab === 'events' ? 'active' : ''}`}
                  onClick={() => setActiveTab('events')}
                >
                  {t('tab_events')}
                </button>
              </div>
            </div>
            <div style={{ display: 'flex', gap: '12px' }}>
              {activeTab === 'nodes' && (
                <button className="button-ghost-on-dark button-ghost-sm" onClick={() => setShowAddModal(true)}>
                  {t('create_node_btn')}
                </button>
              )}
              {activeTab === 'events' && (
                <button className="button-ghost-on-dark button-ghost-sm" onClick={loadSystemEvents}>
                  {loadingEvents ? '...' : `${t('refresh_fleet')} ⟳`}
                </button>
              )}
              <button className="button-ghost-on-dark button-ghost-sm" onClick={handleLogout}>
                {t('admin_logout_btn')}
              </button>
            </div>
          </div>

          {adminBannerWarning && (
            <div style={{
              margin: '0 0 16px 0',
              padding: '12px 16px',
              backgroundColor: 'rgba(255, 170, 0, 0.08)',
              border: '1px solid #ffaa00',
              borderRadius: '4px',
              color: '#ffaa00',
              fontSize: '12px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center'
            }}>
              <span>⚠️ {adminBannerWarning}</span>
              <button
                className="button-ghost-on-dark button-ghost-sm"
                style={{ borderColor: '#ffaa00', color: '#ffaa00', padding: '2px 8px', minHeight: 'auto' }}
                onClick={() => setAdminBannerWarning(null)}
              >
                DISMISS
              </button>
            </div>
          )}

          {/* TAB 1: Node Table */}
          {activeTab === 'nodes' && (
            <div className="map-band" style={{ padding: 0 }}>
              <table className="spacex-table">
                <thead>
                  <tr>
                    <th>{t('th_node_identifier')}</th>
                    <th>{t('th_node_uuid')}</th>
                    <th>{t('th_billing_reset')}</th>
                    <th>{t('th_provision_date')}</th>
                    <th>{t('th_actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {adminNodes.map((n) => (
                    <tr key={n.id}>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                          <strong>{n.name.toUpperCase()}</strong>
                          {n.plan_price != null && n.plan_price > 0 && (
                            <span className="spacex-chip" style={{ color: '#00e676', borderColor: 'rgba(0, 230, 118, 0.4)', fontSize: '10px' }}>
                              {n.plan_currency || 'USD'} {n.plan_price}/{n.billing_cycle || 'mo'}
                            </span>
                          )}
                          {n.billing_cycle === 'free' && (
                            <span className="spacex-chip" style={{ color: 'var(--colors-muted)', fontSize: '10px' }}>
                              FREE
                            </span>
                          )}
                        </div>
                      </td>
                      <td>
                        <span style={{ fontFamily: 'monospace', fontSize: '11px', color: 'var(--colors-on-primary-mute)' }}>
                          {n.id}
                        </span>
                      </td>
                      <td>{t('day_prefix')}{n.traffic_reset_day}{t('day_suffix')}</td>
                      <td>{formatBeijingDate(n.created_at_ms)}</td>
                      <td>
                        <div style={{ display: 'flex', gap: '8px' }}>
                          <button
                            className="button-ghost-on-dark button-ghost-sm"
                            style={{ borderColor: '#38bdf8', color: '#38bdf8' }}
                            onClick={() => openEditModal(n)}
                          >
                            ⚙️ {t('btn_edit')}
                          </button>
                          <button
                            className="button-ghost-on-dark button-ghost-sm"
                            style={{ borderColor: '#a78bfa', color: '#a78bfa' }}
                            onClick={() => {
                              setCmdTab('linux_install');
                              setOneTimeTokenModal({
                                nodeId: n.id,
                                rawToken: '<YOUR_NODE_TOKEN>',
                              });
                            }}
                          >
                            📋 {t('btn_commands')}
                          </button>
                          <button
                            className="button-ghost-on-dark button-ghost-sm"
                            onClick={() => handleRotateToken(n.id)}
                          >
                            {t('btn_rotate')}
                          </button>
                          <button
                            className="button-ghost-on-dark button-ghost-sm button-ghost-danger"
                            onClick={() => handleDeleteNode(n.id)}
                          >
                            {t('btn_delete')}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* TAB 2: Alerts & Webhooks (Decoupled Channels & Policies) */}
          {activeTab === 'alerts' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
              {/* SECTION 1: Notification Channels */}
              <div className="map-band" style={{ padding: '20px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '10px' }}>
                  <div>
                    <span className="eyebrow-cap">📢 {t('channels_title')} ({alertRules.filter(r => r.type === 'channel' || r.type === 'webhook').length})</span>
                  </div>
                  <button className="button-ghost-on-dark button-ghost-sm" onClick={openAddChannelModal}>
                    {t('channels_add_btn')}
                  </button>
                </div>

                <table className="spacex-table">
                  <thead>
                    <tr>
                      <th>{t('th_channel_name')}</th>
                      <th>{t('th_channel_type')}</th>
                      <th>{t('th_channel_target')}</th>
                      <th>{t('th_channel_status')}</th>
                      <th>{t('th_actions')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loadingAlerts ? (
                      <tr>
                        <td colSpan={5} style={{ textAlign: 'center', padding: '24px', color: 'var(--colors-muted)' }}>
                          ...
                        </td>
                      </tr>
                    ) : alertRules.filter(r => r.type === 'channel' || r.type === 'webhook').length === 0 ? (
                      <tr>
                        <td colSpan={5} style={{ textAlign: 'center', padding: '24px', color: 'var(--colors-muted)' }}>
                          {t('no_channels_configured')}
                        </td>
                      </tr>
                    ) : (
                      alertRules.filter(r => r.type === 'channel' || r.type === 'webhook').map((channel) => {
                        let parsedConfig: any = {};
                        try {
                          parsedConfig = channel.config_json ? JSON.parse(channel.config_json) : {};
                        } catch {
                          parsedConfig = {};
                        }
                        const platform = parsedConfig.channel || 'WEBHOOK';

                        return (
                          <tr key={channel.id}>
                            <td>
                              <strong style={{ fontSize: '13px' }}>{parsedConfig.name || t('channels_title')}</strong>
                            </td>
                            <td>
                              <span className="spacex-chip" style={{ color: '#00e676', borderColor: '#00e676' }}>
                                {platform.toUpperCase()}
                              </span>
                            </td>
                            <td>
                              <span style={{ fontSize: '11px', color: 'var(--colors-muted)' }}>
                                🔒 AES-GCM Encrypted
                              </span>
                            </td>
                            <td>
                              <span className={`spacex-chip ${channel.enabled ? 'spacex-chip-active' : ''}`}>
                                {channel.enabled ? 'ACTIVE' : 'DISABLED'}
                              </span>
                            </td>
                            <td>
                              <div style={{ display: 'flex', gap: '8px' }}>
                                <button
                                  className="button-ghost-on-dark button-ghost-sm"
                                  style={{ borderColor: '#38bdf8', color: '#38bdf8' }}
                                  onClick={() => openEditChannelModal(channel)}
                                >
                                  {t('btn_edit')}
                                </button>
                                <button
                                  className="button-ghost-on-dark button-ghost-sm button-ghost-danger"
                                  onClick={() => handleDeleteAlert(channel.id)}
                                >
                                  {t('btn_delete')}
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>

              {/* SECTION 2: Alert Rules & Policies */}
              <div className="map-band" style={{ padding: '20px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '10px' }}>
                  <div>
                    <span className="eyebrow-cap">🚨 {t('policies_title')} ({alertRules.filter(r => r.type !== 'channel' && r.type !== 'webhook').length})</span>
                  </div>
                  <button className="button-ghost-on-dark button-ghost-sm" style={{ backgroundColor: 'rgba(56, 189, 248, 0.1)', borderColor: '#38bdf8', color: '#38bdf8' }} onClick={openAddPolicyModal}>
                    {t('policies_add_btn')}
                  </button>
                </div>

                <table className="spacex-table">
                  <thead>
                    <tr>
                      <th>{t('th_policy_name')}</th>
                      <th colSpan={2}>{t('th_policy_conditions')}</th>
                      <th>{t('th_policy_channels')}</th>
                      <th>{t('th_policy_scope')}</th>
                      <th>{t('th_actions')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loadingAlerts ? (
                      <tr>
                        <td colSpan={6} style={{ textAlign: 'center', padding: '24px', color: 'var(--colors-muted)' }}>
                          ...
                        </td>
                      </tr>
                    ) : alertRules.filter(r => r.type !== 'channel' && r.type !== 'webhook').length === 0 ? (
                      <tr>
                        <td colSpan={6} style={{ textAlign: 'center', padding: '24px', color: 'var(--colors-muted)' }}>
                          {t('no_policies_configured')}
                        </td>
                      </tr>
                    ) : (
                      alertRules.filter(r => r.type !== 'channel' && r.type !== 'webhook').map((rule) => {
                        let parsedConfig: any = {};
                        try {
                          parsedConfig = rule.config_json ? JSON.parse(rule.config_json) : {};
                        } catch {
                          parsedConfig = {};
                        }

                        const targetNode = rule.node_id ? adminNodes.find((n) => n.id === rule.node_id) : null;
                        const scopeText = targetNode ? `${targetNode.name} (${targetNode.id.substring(0, 8)}...)` : t('scope_global');

                        // Resolve associated channels
                        const allChannels = alertRules.filter(r => r.type === 'channel' || r.type === 'webhook');
                        const associatedChannels = Array.isArray(parsedConfig.channel_ids) && parsedConfig.channel_ids.length > 0
                          ? allChannels.filter(c => parsedConfig.channel_ids.includes(c.id))
                          : [];

                        return (
                          <tr key={rule.id}>
                            <td>
                              <strong style={{ fontSize: '13px' }}>{parsedConfig.name || `${rule.type.toUpperCase()} Policy`}</strong>
                            </td>
                            <td colSpan={2}>
                              {parsedConfig.conditions ? (
                                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                                  {parsedConfig.conditions.offline?.enabled && (
                                    <span className="spacex-chip" style={{ color: '#e22718', borderColor: '#e22718', fontSize: '10px' }}>
                                      ⚠️ {t('policy_cond_offline')} &gt; {parsedConfig.conditions.offline.duration_sec || 90}s
                                    </span>
                                  )}
                                  {parsedConfig.conditions.cpu?.enabled && (
                                    <span className="spacex-chip" style={{ color: '#ffaa00', borderColor: '#ffaa00', fontSize: '10px' }}>
                                      🔥 CPU &ge; {parsedConfig.conditions.cpu.threshold}% ({parsedConfig.conditions.cpu.duration_sec}s)
                                    </span>
                                  )}
                                  {parsedConfig.conditions.memory?.enabled && (
                                    <span className="spacex-chip" style={{ color: '#38bdf8', borderColor: '#38bdf8', fontSize: '10px' }}>
                                      🧠 RAM &ge; {parsedConfig.conditions.memory.threshold}% ({parsedConfig.conditions.memory.duration_sec}s)
                                    </span>
                                  )}
                                  {parsedConfig.conditions.disk?.enabled && (
                                    <span className="spacex-chip" style={{ color: '#c084fc', borderColor: '#c084fc', fontSize: '10px' }}>
                                      💾 DISK &ge; {parsedConfig.conditions.disk.threshold}%
                                    </span>
                                  )}
                                  {parsedConfig.conditions.expiry?.enabled && (
                                    <span className="spacex-chip" style={{ color: '#fbbf24', borderColor: '#fbbf24', fontSize: '10px' }}>
                                      📅 EXP &le; {parsedConfig.conditions.expiry.days}d
                                    </span>
                                  )}
                                </div>
                              ) : (
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                  <span className="spacex-chip" style={{
                                    borderColor: rule.type === 'offline' ? '#e22718' : '#38bdf8',
                                    color: rule.type === 'offline' ? '#e22718' : '#38bdf8',
                                  }}>
                                    {rule.type.toUpperCase()}
                                  </span>
                                  <span style={{ fontSize: '12px' }}>
                                    {rule.type === 'offline' ? `> ${rule.duration_sec || 90}s` : `${rule.type.toUpperCase()} ≥ ${rule.threshold}% (${rule.duration_sec}s)`}
                                  </span>
                                </div>
                              )}
                            </td>
                            <td>
                              {associatedChannels.length === 0 ? (
                                <span style={{ fontSize: '11px', color: 'var(--colors-muted)' }}>{t('channel_all_default')}</span>
                              ) : (
                                <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                                  {associatedChannels.map(c => {
                                    const cConfig = c.config_json ? JSON.parse(c.config_json) : {};
                                    return (
                                      <span key={c.id} className="spacex-chip" style={{ fontSize: '10px', color: '#00e676', borderColor: '#00e676' }}>
                                        📢 {cConfig.name || t('channels_title')}
                                      </span>
                                    );
                                  })}
                                </div>
                              )}
                            </td>
                            <td>
                              <span style={{ fontSize: '12px', color: 'var(--colors-muted)' }}>{scopeText}</span>
                            </td>
                            <td>
                              <div style={{ display: 'flex', gap: '8px' }}>
                                <button
                                  className="button-ghost-on-dark button-ghost-sm"
                                  style={{ borderColor: '#38bdf8', color: '#38bdf8' }}
                                  onClick={() => openEditPolicyModal(rule)}
                                >
                                  {t('btn_edit')}
                                </button>
                                <button
                                  className="button-ghost-on-dark button-ghost-sm button-ghost-danger"
                                  onClick={() => handleDeleteAlert(rule.id)}
                                >
                                  {t('btn_delete')}
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TAB 3: Audit Events */}
          {activeTab === 'events' && (
            <div className="map-band" style={{ padding: 0 }}>
              <table className="spacex-table">
                <thead>
                  <tr>
                    <th>时间 / TIME</th>
                    <th>节点 / NODE</th>
                    <th>事件类型 / EVENT TYPE</th>
                    <th>事件内容 / DETAIL</th>
                  </tr>
                </thead>
                <tbody>
                  {loadingEvents ? (
                    <tr>
                      <td colSpan={4} style={{ textAlign: 'center', padding: '32px', color: 'var(--colors-muted)' }}>
                        正在加载审计日志...
                      </td>
                    </tr>
                  ) : systemEvents.length === 0 ? (
                    <tr>
                      <td colSpan={4} style={{ textAlign: 'center', padding: '32px', color: 'var(--colors-muted)' }}>
                        暂无系统审计事件记录。
                      </td>
                    </tr>
                  ) : (
                    systemEvents.map((evt) => {
                      const targetNode = evt.node_id ? adminNodes.find((n) => n.id === evt.node_id) : null;
                      return (
                        <tr key={evt.id}>
                          <td>{formatBeijingDate(evt.ts_ms || evt.created_at_ms)}</td>
                          <td>
                            {targetNode ? (
                              <strong>{targetNode.name.toUpperCase()}</strong>
                            ) : evt.node_id ? (
                              <span style={{ fontFamily: 'monospace', fontSize: '11px' }}>{evt.node_id.substring(0, 8)}...</span>
                            ) : (
                              <span style={{ color: 'var(--colors-muted)' }}>SYSTEM</span>
                            )}
                          </td>
                          <td>
                            <span className="spacex-chip" style={{
                              borderColor: evt.type.includes('fail') ? '#e22718' : evt.type.includes('alert') ? '#f59e0b' : '#38bdf8',
                              color: evt.type.includes('fail') ? '#e22718' : evt.type.includes('alert') ? '#f59e0b' : '#38bdf8',
                            }}>
                              {evt.type.toUpperCase()}
                            </span>
                          </td>
                          <td>
                            <span style={{ fontFamily: 'monospace', fontSize: '11px', color: 'var(--colors-muted)', wordBreak: 'break-all' }}>
                              {evt.data_json || evt.payload_json || '-'}
                            </span>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          )}

          {/* Provision Node Modal */}
          {showAddModal && (
            <div className="modal-backdrop-dark">
              <div className="modal-box-dark">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                  <span className="eyebrow-cap">{t('create_node_title')}</span>
                  <button
                    style={{ background: 'none', border: 'none', color: '#ffffff', fontSize: '18px', cursor: 'pointer' }}
                    onClick={() => setShowAddModal(false)}
                  >
                    ✕
                  </button>
                </div>

                <form onSubmit={handleCreateNode}>
                  <div style={{ marginBottom: '16px' }}>
                    <span className="eyebrow-cap" style={{ display: 'block', marginBottom: '8px' }}>{t('node_name_label')}</span>
                    <input
                      value={newNodeName}
                      onChange={(e) => setNewNodeName(e.target.value)}
                      className="spacex-input"
                      placeholder="e.g. TOKYO-01"
                      required
                    />
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
                    <div>
                      <span className="eyebrow-cap" style={{ display: 'block', marginBottom: '8px' }}>{t('reset_day_label')}</span>
                      <input
                        value={newNodeResetDay}
                        onChange={(e) => setNewNodeResetDay(parseInt(e.target.value) || 1)}
                        type="number"
                        min={1}
                        max={31}
                        className="spacex-input"
                      />
                    </div>
                    <div>
                      <span className="eyebrow-cap" style={{ display: 'block', marginBottom: '8px' }}>{t('quota_gb_label')}</span>
                      <input
                        value={newNodeQuotaGb}
                        onChange={(e) => setNewNodeQuotaGb(e.target.value)}
                        type="number"
                        min={0}
                        placeholder="e.g. 1000"
                        className="spacex-input"
                      />
                    </div>
                  </div>

                  {/* Finance / Price & Currency */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
                    <div>
                      <span className="eyebrow-cap" style={{ display: 'block', marginBottom: '8px' }}>服务器价格 / Price (Optional)</span>
                      <input
                        value={newNodePrice}
                        onChange={(e) => setNewNodePrice(e.target.value)}
                        type="number"
                        step="0.01"
                        min={0}
                        placeholder="如 15.00 (免费留空)"
                        className="spacex-input"
                      />
                    </div>
                    <div>
                      <span className="eyebrow-cap" style={{ display: 'block', marginBottom: '8px' }}>结算币种 / Currency</span>
                      <select
                        value={newNodeCurrency}
                        onChange={(e) => setNewNodeCurrency(e.target.value)}
                        className="spacex-input"
                        style={{ cursor: 'pointer' }}
                      >
                        <option value="USD">USD ($)</option>
                        <option value="CNY">CNY (¥)</option>
                        <option value="EUR">EUR (€)</option>
                        <option value="HKD">HKD (HK$)</option>
                        <option value="GBP">GBP (£)</option>
                        <option value="JPY">JPY (¥)</option>
                      </select>
                    </div>
                  </div>

                  {/* Finance / Cycle & Auto Renewal */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
                    <div>
                      <span className="eyebrow-cap" style={{ display: 'block', marginBottom: '8px' }}>计费周期 / Billing Cycle</span>
                      <select
                        value={newNodeCycle}
                        onChange={(e) => setNewNodeCycle(e.target.value)}
                        className="spacex-input"
                        style={{ cursor: 'pointer' }}
                      >
                        <option value="monthly">月付 (Monthly)</option>
                        <option value="quarterly">季付 (Quarterly)</option>
                        <option value="semi_annually">半年付 (Semi-Annually)</option>
                        <option value="annually">年付 (Annually)</option>
                        <option value="biennially">两年付 (Biennially)</option>
                        <option value="triennially">三年付 (Triennially)</option>
                        <option value="one_time">一次性/买断 (One-Time)</option>
                        <option value="free">免费 (Free)</option>
                      </select>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', marginTop: '24px', gap: '10px' }}>
                      <input
                        type="checkbox"
                        id="add_auto_renewal_checkbox"
                        checked={newNodeAutoRenewal}
                        onChange={(e) => setNewNodeAutoRenewal(e.target.checked)}
                        style={{ cursor: 'pointer', width: '16px', height: '16px' }}
                      />
                      <label htmlFor="add_auto_renewal_checkbox" style={{ fontSize: '12px', color: '#ffffff', cursor: 'pointer' }}>
                        自动续费 (Auto Renewal)
                      </label>
                    </div>
                  </div>

                  <div style={{ marginBottom: '16px' }}>
                    <span className="eyebrow-cap" style={{ display: 'block', marginBottom: '8px' }}>{t('th_expire')} (Optional)</span>
                    <input
                      value={newNodeExpiresAt}
                      onChange={(e) => setNewNodeExpiresAt(e.target.value)}
                      type="date"
                      className="spacex-input"
                    />
                  </div>

                  <div style={{ marginBottom: '20px' }}>
                    <span className="eyebrow-cap" style={{ display: 'block', marginBottom: '8px' }}>Note / 备注 (Optional)</span>
                    <input
                      value={newNodeNote}
                      onChange={(e) => setNewNodeNote(e.target.value)}
                      placeholder="e.g. Racknerd 2C2G US-West"
                      className="spacex-input"
                    />
                  </div>

                  {/* Telemetry Frequency & Reporting Settings */}
                  <div style={{ padding: '14px', background: 'rgba(255, 255, 255, 0.02)', borderRadius: '6px', border: '1px solid var(--colors-hairline-on-dark)', marginBottom: '24px' }}>
                    <span className="eyebrow-cap" style={{ display: 'block', marginBottom: '12px', color: '#ffffff' }}>
                      ⚙️ 采集与推流频率 / TELEMETRY FREQUENCY
                    </span>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '12px' }}>
                      <div>
                        <span className="eyebrow-cap" style={{ display: 'block', marginBottom: '6px' }}>本地采样间隔 / Sample (秒, 1~60)</span>
                        <input
                          type="number"
                          min={1}
                          max={60}
                          value={newNodeSampleInterval}
                          onChange={(e) => setNewNodeSampleInterval(Math.max(1, Math.min(60, parseInt(e.target.value) || 2)))}
                          className="spacex-input"
                        />
                      </div>
                      <div>
                        <span className="eyebrow-cap" style={{ display: 'block', marginBottom: '6px' }}>推流上报间隔 / Stream (秒, 1~60)</span>
                        <input
                          type="number"
                          min={1}
                          max={60}
                          value={newNodeStreamInterval}
                          onChange={(e) => setNewNodeStreamInterval(Math.max(1, Math.min(60, parseInt(e.target.value) || 2)))}
                          className="spacex-input"
                        />
                      </div>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
                      <div>
                        <span className="eyebrow-cap" style={{ display: 'block', marginBottom: '6px' }}>网络探测间隔 / Probe (秒, 10~3600)</span>
                        <input
                          type="number"
                          min={10}
                          max={3600}
                          value={newNodeProbeInterval}
                          onChange={(e) => setNewNodeProbeInterval(Math.max(10, Math.min(3600, parseInt(e.target.value) || 60)))}
                          className="spacex-input"
                        />
                      </div>
                      <div>
                        <span className="eyebrow-cap" style={{ display: 'block', marginBottom: '6px' }}>绑定网卡 / Interface (默认 auto)</span>
                        <input
                          type="text"
                          value={newNodeNetIface}
                          onChange={(e) => setNewNodeNetIface(e.target.value)}
                          placeholder="auto"
                          className="spacex-input"
                        />
                      </div>
                    </div>
                    <div style={{ fontSize: '11px', color: 'var(--colors-muted)', marginTop: '8px' }}>
                      💡 默认 2 秒超高频实时推流。数据库 D1 严格按 60 秒时间窗口合并归档，两者独立解耦无干涉。
                    </div>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
                    <button type="button" className="button-ghost-on-dark button-ghost-sm" onClick={() => setShowAddModal(false)}>
                      {t('cancel_btn')}
                    </button>
                    <button type="submit" className="button-ghost-on-dark button-ghost-sm" style={{ backgroundColor: '#ffffff', color: '#000000' }}>
                      {t('save_node_btn')}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}

          {/* Unified Large Node Edit Modal (Single Scrollable Panel, No Tabs) */}
          {editingNode && (
            <div className="modal-backdrop-dark">
              <div className="modal-box-dark" style={{ maxWidth: '760px', maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}>
                {/* Fixed Modal Header */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', paddingBottom: '12px', borderBottom: '1px solid var(--colors-hairline-on-dark)' }}>
                  <div>
                    <span className="eyebrow-cap">⚙️ {t('edit_node_title')} // {editingNode.id}</span>
                    <h3 style={{ fontSize: '18px', fontWeight: 700, marginTop: '4px' }}>{editingNode.name}</h3>
                  </div>
                  <button
                    style={{ background: 'none', border: 'none', color: '#ffffff', fontSize: '18px', cursor: 'pointer' }}
                    onClick={() => {
                      setEditingNode(null);
                      setEditingConfig(null);
                    }}
                  >
                    ✕
                  </button>
                </div>

                {/* Scrollable Form Body */}
                <form onSubmit={handleUpdateNode} style={{ flex: 1, overflowY: 'auto', paddingRight: '4px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
                  {/* SECTION 1: 📋 基础信息与财务账单 */}
                  <div style={{ padding: '16px', background: 'rgba(255, 255, 255, 0.02)', borderRadius: '6px', border: '1px solid var(--colors-hairline-on-dark)' }}>
                    <span className="eyebrow-cap" style={{ fontSize: '11px', display: 'block', marginBottom: '14px', color: '#ffffff' }}>
                      📋 基础信息与财务账单 / BASIC INFO & BILLING
                    </span>

                    <div style={{ marginBottom: '14px' }}>
                      <span className="eyebrow-cap" style={{ display: 'block', marginBottom: '6px' }}>{t('node_name_label')}</span>
                      <input
                        value={editingNode.name}
                        onChange={(e) => setEditingNode({ ...editingNode, name: e.target.value })}
                        className="spacex-input"
                        placeholder="e.g. TOKYO-01"
                        required
                      />
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '14px' }}>
                      <div>
                        <span className="eyebrow-cap" style={{ display: 'block', marginBottom: '6px' }}>{t('reset_day_label')}</span>
                        <input
                          value={editingNode.traffic_reset_day}
                          onChange={(e) => setEditingNode({ ...editingNode, traffic_reset_day: parseInt(e.target.value) || 1 })}
                          type="number"
                          min={1}
                          max={31}
                          className="spacex-input"
                        />
                      </div>
                      <div>
                        <span className="eyebrow-cap" style={{ display: 'block', marginBottom: '6px' }}>{t('quota_gb_label')}</span>
                        <input
                          value={editingNode.traffic_quota_gb}
                          onChange={(e) => setEditingNode({ ...editingNode, traffic_quota_gb: e.target.value })}
                          type="number"
                          min={0}
                          placeholder="如 1000 (留空为无配额)"
                          className="spacex-input"
                        />
                      </div>
                    </div>

                    {/* Price & Currency */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '14px' }}>
                      <div>
                        <span className="eyebrow-cap" style={{ display: 'block', marginBottom: '6px' }}>服务器价格 / Price (Optional)</span>
                        <input
                          value={editingNode.plan_price}
                          onChange={(e) => setEditingNode({ ...editingNode, plan_price: e.target.value })}
                          type="number"
                          step="0.01"
                          min={0}
                          placeholder="如 15.00 (免费留空)"
                          className="spacex-input"
                        />
                      </div>
                      <div>
                        <span className="eyebrow-cap" style={{ display: 'block', marginBottom: '6px' }}>结算币种 / Currency</span>
                        <select
                          value={editingNode.plan_currency}
                          onChange={(e) => setEditingNode({ ...editingNode, plan_currency: e.target.value })}
                          className="spacex-input"
                          style={{ cursor: 'pointer', background: '#000000', color: '#ffffff' }}
                        >
                          <option value="USD">USD ($)</option>
                          <option value="CNY">CNY (¥)</option>
                          <option value="EUR">EUR (€)</option>
                          <option value="HKD">HKD (HK$)</option>
                          <option value="GBP">GBP (£)</option>
                          <option value="JPY">JPY (¥)</option>
                        </select>
                      </div>
                    </div>

                    {/* Cycle & Auto Renewal */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '14px' }}>
                      <div>
                        <span className="eyebrow-cap" style={{ display: 'block', marginBottom: '6px' }}>计费周期 / Billing Cycle</span>
                        <select
                          value={editingNode.billing_cycle}
                          onChange={(e) => setEditingNode({ ...editingNode, billing_cycle: e.target.value })}
                          className="spacex-input"
                          style={{ cursor: 'pointer', background: '#000000', color: '#ffffff' }}
                        >
                          <option value="monthly">月付 (Monthly)</option>
                          <option value="quarterly">季付 (Quarterly)</option>
                          <option value="semi_annually">半年付 (Semi-Annually)</option>
                          <option value="annually">年付 (Annually)</option>
                          <option value="biennially">两年付 (Biennially)</option>
                          <option value="triennially">三年付 (Triennially)</option>
                          <option value="one_time">一次性/买断 (One-Time)</option>
                          <option value="free">免费 (Free)</option>
                        </select>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', marginTop: '22px', gap: '10px' }}>
                        <input
                          type="checkbox"
                          id="edit_auto_renewal_checkbox"
                          checked={editingNode.auto_renewal}
                          onChange={(e) => setEditingNode({ ...editingNode, auto_renewal: e.target.checked })}
                          style={{ cursor: 'pointer', width: '16px', height: '16px' }}
                        />
                        <label htmlFor="edit_auto_renewal_checkbox" style={{ fontSize: '12px', color: '#ffffff', cursor: 'pointer' }}>
                          自动续费 (Auto Renewal)
                        </label>
                      </div>
                    </div>

                    <div style={{ marginBottom: '14px' }}>
                      <span className="eyebrow-cap" style={{ display: 'block', marginBottom: '6px' }}>{t('th_expire')} (Optional)</span>
                      <input
                        value={editingNode.expires_at}
                        onChange={(e) => setEditingNode({ ...editingNode, expires_at: e.target.value })}
                        type="date"
                        className="spacex-input"
                      />
                    </div>

                    <div style={{ marginBottom: '14px' }}>
                      <span className="eyebrow-cap" style={{ display: 'block', marginBottom: '6px' }}>Note / 备注 (Optional)</span>
                      <input
                        value={editingNode.note}
                        onChange={(e) => setEditingNode({ ...editingNode, note: e.target.value })}
                        placeholder="e.g. 搬瓦工 CN2-GIA 2C2G"
                        className="spacex-input"
                      />
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <input
                        type="checkbox"
                        id="edit_hidden_checkbox"
                        checked={editingNode.hidden}
                        onChange={(e) => setEditingNode({ ...editingNode, hidden: e.target.checked })}
                        style={{ cursor: 'pointer', width: '16px', height: '16px' }}
                      />
                      <label htmlFor="edit_hidden_checkbox" style={{ fontSize: '12px', color: '#ffffff', cursor: 'pointer' }}>
                        在公开首页隐藏此节点（仅管理员登录后可见）
                      </label>
                    </div>
                  </div>

                  {/* SECTION 2: ⚙️ 采集与推流频率设置 */}
                  {editingConfig && (
                    <div style={{ padding: '16px', background: 'rgba(255, 255, 255, 0.02)', borderRadius: '6px', border: '1px solid var(--colors-hairline-on-dark)' }}>
                      <span className="eyebrow-cap" style={{ fontSize: '11px', display: 'block', marginBottom: '14px', color: '#ffffff' }}>
                        ⚙️ 采集与推流频率设置 / TELEMETRY FREQUENCY
                      </span>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '12px' }}>
                        <div>
                          <span className="eyebrow-cap" style={{ display: 'block', marginBottom: '6px' }}>本地采样间隔 / Sample (秒, 1~60)</span>
                          <input
                            type="number"
                            min={1}
                            max={60}
                            value={editingConfig.sample_interval_sec ?? 2}
                            onChange={(e) => setEditingConfig({
                              ...editingConfig,
                              sample_interval_sec: Math.max(1, Math.min(60, parseInt(e.target.value) || 2))
                            })}
                            className="spacex-input"
                          />
                        </div>
                        <div>
                          <span className="eyebrow-cap" style={{ display: 'block', marginBottom: '6px' }}>推流上报间隔 / Stream (秒, 1~60)</span>
                          <input
                            type="number"
                            min={1}
                            max={60}
                            value={editingConfig.stream_interval_sec ?? 2}
                            onChange={(e) => setEditingConfig({
                              ...editingConfig,
                              stream_interval_sec: Math.max(1, Math.min(60, parseInt(e.target.value) || 2))
                            })}
                            className="spacex-input"
                          />
                        </div>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
                        <div>
                          <span className="eyebrow-cap" style={{ display: 'block', marginBottom: '6px' }}>网络探测间隔 / Probe (秒, 10~3600)</span>
                          <input
                            type="number"
                            min={10}
                            max={3600}
                            value={editingConfig.probe_interval_sec ?? 60}
                            onChange={(e) => setEditingConfig({
                              ...editingConfig,
                              probe_interval_sec: Math.max(10, Math.min(3600, parseInt(e.target.value) || 60))
                            })}
                            className="spacex-input"
                          />
                        </div>
                        <div>
                          <span className="eyebrow-cap" style={{ display: 'block', marginBottom: '6px' }}>绑定网卡 / Interface (默认 auto)</span>
                          <input
                            type="text"
                            value={editingConfig.network_interface ?? 'auto'}
                            onChange={(e) => setEditingConfig({
                              ...editingConfig,
                              network_interface: e.target.value
                            })}
                            placeholder="auto"
                            className="spacex-input"
                          />
                        </div>
                      </div>
                      <div style={{ fontSize: '11px', color: 'var(--colors-muted)', marginTop: '8px' }}>
                        💡 保存后通过 WebSocket 即时下发并热生效至在线 Agent，无需重启。D1 数据库每 60 秒合流归档，两者独立运行无干涉。
                      </div>
                    </div>
                  )}

                  {/* SECTION 3: 📡 网络连通性雷达探针 */}
                  <div style={{ padding: '16px', background: 'rgba(255, 255, 255, 0.02)', borderRadius: '6px', border: '1px solid var(--colors-hairline-on-dark)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', flexWrap: 'wrap', gap: '8px' }}>
                      <span className="eyebrow-cap" style={{ fontSize: '11px', color: '#ffffff' }}>
                        📡 网络连通性雷达探针 / NETWORK PROBES ({(editingConfig?.probes || []).length})
                      </span>
                      {/* Quick Presets Bar */}
                      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                        <button
                          type="button"
                          className="button-ghost-on-dark button-ghost-sm"
                          style={{ borderColor: '#38bdf8', color: '#38bdf8', fontSize: '10px', padding: '2px 8px' }}
                          onClick={() => handleApplyPreset('china_3net')}
                        >
                          🇨🇳 {t('preset_china_3net')}
                        </button>
                        <button
                          type="button"
                          className="button-ghost-on-dark button-ghost-sm"
                          style={{ borderColor: '#38bdf8', color: '#38bdf8', fontSize: '10px', padding: '2px 8px' }}
                          onClick={() => handleApplyPreset('global_infra')}
                        >
                          🌐 {t('preset_global_infra')}
                        </button>
                        <button
                          type="button"
                          className="button-ghost-on-dark button-ghost-sm"
                          style={{ borderColor: '#38bdf8', color: '#38bdf8', fontSize: '10px', padding: '2px 8px' }}
                          onClick={() => handleApplyPreset('minimal_ping')}
                        >
                          ⚡ {t('preset_minimal_ping')}
                        </button>
                      </div>
                    </div>

                    {/* Probes List */}
                    <div style={{ marginBottom: '14px' }}>
                      {(!editingConfig?.probes || editingConfig.probes.length === 0) ? (
                        <div style={{ padding: '12px', textAlign: 'center', color: 'var(--colors-muted)', fontSize: '12px', border: '1px dashed var(--colors-hairline-on-dark)', borderRadius: '4px' }}>
                          暂未配置探测目标，请点击上方预设或在下方手动添加。
                        </div>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '160px', overflowY: 'auto' }}>
                          {editingConfig.probes.map((p, idx) => (
                            <div
                              key={p.id + idx}
                              style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                padding: '6px 10px',
                                background: 'rgba(255, 255, 255, 0.03)',
                                borderRadius: '4px',
                                border: '1px solid var(--colors-hairline-on-dark)',
                              }}
                            >
                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <span className="spacex-chip" style={{ fontSize: '9px', padding: '1px 6px' }}>{p.protocol.toUpperCase()}</span>
                                <span style={{ fontWeight: 600, fontSize: '12px' }}>{p.id}</span>
                                <span style={{ color: 'var(--colors-muted)', fontSize: '11px' }}>
                                  ➔ {p.target}{p.port ? `:${p.port}` : ''}
                                </span>
                              </div>
                              <button
                                type="button"
                                className="button-ghost-on-dark button-ghost-sm button-ghost-danger"
                                style={{ padding: '1px 6px', minHeight: 'auto', fontSize: '10px' }}
                                onClick={() => handleRemoveProbe(idx)}
                              >
                                ✕ 删除
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Add Custom Probe Form */}
                    <div style={{ padding: '10px', background: 'rgba(0, 0, 0, 0.3)', borderRadius: '4px', border: '1px solid var(--colors-hairline-on-dark)' }}>
                      <span className="eyebrow-cap" style={{ fontSize: '9px', display: 'block', marginBottom: '6px' }}>
                        + 添加自定义探测目标
                      </span>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.5fr 80px 1fr', gap: '8px', alignItems: 'center' }}>
                        <input
                          placeholder="标识 (如 ct-hk)"
                          value={newProbeId}
                          onChange={(e) => setNewProbeId(e.target.value)}
                          className="spacex-input"
                          style={{ fontSize: '11px', padding: '4px 6px' }}
                        />
                        <input
                          placeholder="IP 或域名 (如 1.1.1.1)"
                          value={newProbeTarget}
                          onChange={(e) => setNewProbeTarget(e.target.value)}
                          className="spacex-input"
                          style={{ fontSize: '11px', padding: '4px 6px' }}
                        />
                        <select
                          value={newProbeProtocol}
                          onChange={(e) => setNewProbeProtocol(e.target.value as any)}
                          className="spacex-input"
                          style={{ fontSize: '11px', padding: '4px 6px', background: '#000000', color: '#ffffff' }}
                        >
                          <option value="icmp">ICMP</option>
                          <option value="tcp">TCP</option>
                        </select>
                        {newProbeProtocol === 'tcp' ? (
                          <input
                            type="number"
                            placeholder="端口"
                            value={newProbePort}
                            onChange={(e) => setNewProbePort(parseInt(e.target.value) || 80)}
                            className="spacex-input"
                            style={{ fontSize: '11px', padding: '4px 6px' }}
                          />
                        ) : (
                          <button
                            type="button"
                            className="button-ghost-on-dark button-ghost-sm"
                            onClick={handleAddProbe}
                            style={{ width: '100%', justifyContent: 'center', fontSize: '11px', padding: '4px 8px' }}
                          >
                            + 添加
                          </button>
                        )}
                      </div>
                      {newProbeProtocol === 'tcp' && (
                        <div style={{ marginTop: '6px', display: 'flex', justifyContent: 'flex-end' }}>
                          <button
                            type="button"
                            className="button-ghost-on-dark button-ghost-sm"
                            onClick={handleAddProbe}
                            style={{ fontSize: '11px', padding: '3px 8px' }}
                          >
                            + 确认添加 TCP 探测
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* SECTION 4: 🚨 告警与通知推送策略 */}
                  {editingConfig && (
                    <div style={{ padding: '16px', background: 'rgba(255, 255, 255, 0.02)', borderRadius: '6px', border: '1px solid var(--colors-hairline-on-dark)' }}>
                      <span className="eyebrow-cap" style={{ fontSize: '11px', display: 'block', marginBottom: '12px', color: '#ffffff' }}>
                        🚨 节点告警与通知推送策略 / ALERT NOTIFICATION POLICY
                      </span>

                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px', marginBottom: '12px' }}>
                        <button
                          type="button"
                          className={`range-capsule-btn ${(!editingConfig.alert_policy || editingConfig.alert_policy.mode === 'global') ? 'active' : ''}`}
                          style={{ height: '34px', fontSize: '11px', width: '100%', textTransform: 'none' }}
                          onClick={() => setEditingConfig({
                            ...editingConfig,
                            alert_policy: { mode: 'global', rule_ids: editingConfig.alert_policy?.rule_ids || [] }
                          })}
                        >
                          🌐 继承全局规则
                        </button>
                        <button
                          type="button"
                          className={`range-capsule-btn ${editingConfig.alert_policy?.mode === 'custom' ? 'active' : ''}`}
                          style={{ height: '34px', fontSize: '11px', width: '100%', textTransform: 'none' }}
                          onClick={() => setEditingConfig({
                            ...editingConfig,
                            alert_policy: { mode: 'custom', rule_ids: editingConfig.alert_policy?.rule_ids || [] }
                          })}
                        >
                          ⚙️ 自定义关联规则
                        </button>
                        <button
                          type="button"
                          className={`range-capsule-btn ${editingConfig.alert_policy?.mode === 'none' ? 'active' : ''}`}
                          style={{
                            height: '34px',
                            fontSize: '11px',
                            width: '100%',
                            textTransform: 'none',
                            borderColor: editingConfig.alert_policy?.mode === 'none' ? '#e22718' : undefined,
                            color: editingConfig.alert_policy?.mode === 'none' ? '#e22718' : undefined
                          }}
                          onClick={() => setEditingConfig({
                            ...editingConfig,
                            alert_policy: { mode: 'none', rule_ids: [] }
                          })}
                        >
                          🔕 不推送 (完全静音)
                        </button>
                      </div>

                      {(!editingConfig.alert_policy || editingConfig.alert_policy.mode === 'global') && (
                        <div style={{ fontSize: '11px', color: '#00e676', marginTop: '6px' }}>
                          🌐 已设为继承全局规则：该节点将自动应用在后台「🚨 告警策略」中配置的所有通用规则，以及系统默认的离线与到期检测。
                        </div>
                      )}

                      {editingConfig.alert_policy?.mode === 'custom' && (
                        <div style={{ padding: '12px', background: 'rgba(0, 0, 0, 0.5)', borderRadius: '4px', border: '1px solid var(--colors-hairline-on-dark)', marginTop: '8px' }}>
                          <span style={{ fontSize: '11px', color: 'var(--colors-muted)', display: 'block', marginBottom: '8px' }}>
                            勾选需要对此服务器生效的告警策略：
                          </span>
                          {alertRules.filter(r => r.type !== 'channel' && r.type !== 'webhook').length === 0 ? (
                            <div style={{ fontSize: '11px', color: 'var(--colors-muted)' }}>暂无告警策略，请先在「告警策略与推送」页面创建策略。</div>
                          ) : (
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                              {alertRules.filter(r => r.type !== 'channel' && r.type !== 'webhook').map((p) => {
                                let pConfig: any = {};
                                try { pConfig = p.config_json ? JSON.parse(p.config_json) : {}; } catch { pConfig = {}; }
                                const isChecked = (editingConfig.alert_policy?.rule_ids || []).includes(p.id);
                                return (
                                  <label key={p.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '11px' }}>
                                    <input
                                      type="checkbox"
                                      checked={isChecked}
                                      onChange={(e) => {
                                        const curIds = editingConfig.alert_policy?.rule_ids || [];
                                        const nextIds = e.target.checked
                                          ? [...curIds, p.id]
                                          : curIds.filter(id => id !== p.id);
                                        setEditingConfig({
                                          ...editingConfig,
                                          alert_policy: { mode: 'custom', rule_ids: nextIds }
                                        });
                                      }}
                                    />
                                    <span>{pConfig.name || `${p.type.toUpperCase()} 策略`} ({p.type.toUpperCase()})</span>
                                  </label>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      )}

                      {editingConfig.alert_policy?.mode === 'none' && (
                        <div style={{ fontSize: '11px', color: '#ffaa00', marginTop: '6px' }}>
                          ⚠️ 该节点已被设置为完全静音，发生离线、CPU/内存/磁盘高负载或到期时均不会发送任何推送。
                        </div>
                      )}
                    </div>
                  )}

                  {/* Fixed Form Footer */}
                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', paddingTop: '14px', borderTop: '1px solid var(--colors-hairline-on-dark)' }}>
                    <button
                      type="button"
                      className="button-ghost-on-dark button-ghost-sm"
                      onClick={() => {
                        setEditingNode(null);
                        setEditingConfig(null);
                      }}
                    >
                      {t('cancel_btn')}
                    </button>
                    <button
                      type="submit"
                      disabled={updatingNode}
                      className="button-ghost-on-dark button-ghost-sm"
                      style={{ backgroundColor: '#ffffff', color: '#000000', fontWeight: 700 }}
                    >
                      {updatingNode ? '正在保存...' : '保存所有配置 ➔'}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}

          {/* Token Modal with Multi-OS Command Generator */}
          {oneTimeTokenModal && (() => {
            const serverUrl = window.location.origin;
            const nodeId = oneTimeTokenModal.nodeId;
            const token = oneTimeTokenModal.rawToken;
            const isPlaceholder = token === '<YOUR_NODE_TOKEN>';
            const APP_VERSION = 'v0.1.1';

            const installCmd = `curl -fsSL https://raw.githubusercontent.com/dooooling/edgemon/${APP_VERSION}/scripts/install.sh | sudo bash -s -- --server "${serverUrl}" --id "${nodeId}" --token "${token}" --version ${APP_VERSION}`;
            const binaryCmd = `# 1. 下载解压静态二进制 (${APP_VERSION})\ncurl -fsSL -O "https://github.com/dooooling/edgemon/releases/download/${APP_VERSION}/edgemon-agent-x86_64-unknown-linux-musl.tar.gz" && tar -xzf edgemon-agent-x86_64-unknown-linux-musl.tar.gz\n\n# 2. 启动 Agent\nEDGEMON_SERVER="${serverUrl}" EDGEMON_NODE_ID="${nodeId}" EDGEMON_TOKEN="${token}" ./edgemon-agent`;
            const windowsPsCmd = `# 1. 下载解压 Windows Agent (${APP_VERSION})\nInvoke-WebRequest -Uri "https://github.com/dooooling/edgemon/releases/download/${APP_VERSION}/edgemon-agent-x86_64-pc-windows-msvc.tar.gz" -OutFile "edgemon-agent.tar.gz"; tar -xzf edgemon-agent.tar.gz\n\n# 2. 启动 Agent\n$env:EDGEMON_SERVER="${serverUrl}"; $env:EDGEMON_NODE_ID="${nodeId}"; $env:EDGEMON_TOKEN="${token}"; .\\edgemon-agent.exe`;
            const windowsCmd = `curl -fsSL -o edgemon-agent.tar.gz https://github.com/dooooling/edgemon/releases/download/${APP_VERSION}/edgemon-agent-x86_64-pc-windows-msvc.tar.gz && tar -xzf edgemon-agent.tar.gz && set EDGEMON_SERVER=${serverUrl}&& set EDGEMON_NODE_ID=${nodeId}&& set EDGEMON_TOKEN=${token}&& edgemon-agent.exe`;
            const systemdUnit = `# 1. 创建环境配置文件 /etc/edgemon/agent.env (权限 0600)
mkdir -p /etc/edgemon
cat > /etc/edgemon/agent.env <<EOF
EDGEMON_SERVER=${serverUrl}
EDGEMON_NODE_ID=${nodeId}
EDGEMON_TOKEN=${token}
EOF
chmod 600 /etc/edgemon/agent.env

# 2. 创建 Systemd 服务文件 /etc/systemd/system/edgemon.service
cat > /etc/systemd/system/edgemon.service <<EOF
[Unit]
Description=EdgeMon Telemetry Agent
Documentation=https://github.com/dooooling/edgemon
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
EnvironmentFile=/etc/edgemon/agent.env
ExecStart=/usr/local/bin/edgemon-agent
Restart=always
RestartSec=5s
LimitNOFILE=65535
MemoryMax=64M

[Install]
WantedBy=multi-user.target
EOF

# 3. 启动并启用开机自启
systemctl daemon-reload && systemctl enable --now edgemon`;

            let currentCmd = installCmd;
            if (cmdTab === 'linux_binary') currentCmd = binaryCmd;
            else if (cmdTab === 'windows_ps') currentCmd = windowsPsCmd;
            else if (cmdTab === 'windows_cmd') currentCmd = windowsCmd;
            else if (cmdTab === 'systemd') currentCmd = systemdUnit;
            else if (cmdTab === 'raw') currentCmd = token;

            return (
              <div className="modal-backdrop-dark">
                <div className="modal-box-dark" style={{ maxWidth: '720px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <h3 className="display-lg" style={{ fontSize: '18px', margin: '0 0 8px 0', color: 'var(--colors-status-live)' }}>
                      🚀 {isPlaceholder ? t('btn_commands') : t('token_modal_title')}
                    </h3>
                    <button
                      style={{ background: 'none', border: 'none', color: '#ffffff', fontSize: '18px', cursor: 'pointer' }}
                      onClick={() => setOneTimeTokenModal(null)}
                    >
                      ✕
                    </button>
                  </div>
                  <p className="caption" style={{ color: isPlaceholder ? 'var(--colors-muted)' : 'var(--colors-status-alert)', margin: '0 0 12px 0' }}>
                    {isPlaceholder ? t('token_placeholder_notice') : t('token_notice')}
                  </p>

                  {isPlaceholder && (
                    <div style={{
                      padding: '8px 12px',
                      backgroundColor: 'rgba(167, 139, 250, 0.1)',
                      border: '1px solid #a78bfa',
                      borderRadius: '4px',
                      marginBottom: '16px',
                      fontSize: '11px',
                      color: '#c4b5fd',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: '8px',
                      flexWrap: 'wrap',
                    }}>
                      <span>ℹ️ {t('token_placeholder_notice')}</span>
                      <button
                        className="button-ghost-on-dark button-ghost-sm"
                        style={{ borderColor: '#a78bfa', color: '#ffffff', fontSize: '10px', padding: '3px 8px' }}
                        onClick={() => handleRotateToken(nodeId)}
                      >
                        {t('btn_rotate_and_show')}
                      </button>
                    </div>
                  )}

                  {oneTimeTokenModal.warning && (
                    <div style={{
                      padding: '8px 12px',
                      backgroundColor: 'rgba(255, 170, 0, 0.1)',
                      border: '1px solid #ffaa00',
                      borderRadius: '4px',
                      marginBottom: '16px',
                      fontSize: '11px',
                      color: '#ffaa00'
                    }}>
                      ⚠️ WARNING: {oneTimeTokenModal.warning} — Active agent socket disconnect RPC timed out. Existing stream will be evicted on next verification.
                    </div>
                  )}

                  {!isPlaceholder && (
                    <div style={{
                      padding: '8px 12px',
                      backgroundColor: 'rgba(255, 170, 0, 0.08)',
                      border: '1px solid rgba(255, 170, 0, 0.3)',
                      borderRadius: '4px',
                      marginBottom: '16px',
                      fontSize: '11px',
                      color: '#ffaa00'
                    }}>
                      {t('cmd_security_notice')}
                    </div>
                  )}

                  {/* OS / Platform Command Tab Selector */}
                  <div className="range-capsules" style={{ margin: '0 0 14px 0', flexWrap: 'wrap', gap: '6px' }}>
                    <button
                      className={`range-capsule-btn ${cmdTab === 'linux_install' ? 'active' : ''}`}
                      onClick={() => setCmdTab('linux_install')}
                    >
                      🐧 {t('cmd_linux_install')}
                    </button>
                    <button
                      className={`range-capsule-btn ${cmdTab === 'linux_binary' ? 'active' : ''}`}
                      onClick={() => setCmdTab('linux_binary')}
                    >
                      🐧 {t('cmd_linux_binary')}
                    </button>
                    <button
                      className={`range-capsule-btn ${cmdTab === 'windows_ps' ? 'active' : ''}`}
                      onClick={() => setCmdTab('windows_ps')}
                    >
                      🪟 {t('cmd_windows_ps')}
                    </button>
                    <button
                      className={`range-capsule-btn ${cmdTab === 'windows_cmd' ? 'active' : ''}`}
                      onClick={() => setCmdTab('windows_cmd')}
                    >
                      🪟 {t('cmd_windows_cmd')}
                    </button>
                    <button
                      className={`range-capsule-btn ${cmdTab === 'systemd' ? 'active' : ''}`}
                      onClick={() => setCmdTab('systemd')}
                    >
                      ⚙️ {t('cmd_systemd_unit')}
                    </button>
                    <button
                      className={`range-capsule-btn ${cmdTab === 'raw' ? 'active' : ''}`}
                      onClick={() => setCmdTab('raw')}
                    >
                      🔑 {t('token_raw')}
                    </button>
                  </div>

                  {/* Command Content Box */}
                  <div style={{ position: 'relative' }}>
                    <pre className="token-view-chassis" style={{
                      margin: 0,
                      padding: '14px 100px 14px 14px',
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-all',
                      fontSize: '12px',
                      lineHeight: '1.5',
                      maxHeight: '260px',
                      overflowY: 'auto',
                    }}>
                      {currentCmd}
                    </pre>

                    {/* Copy Button */}
                    <button
                      className="button-ghost-on-dark button-ghost-sm"
                      style={{
                        position: 'absolute',
                        top: '10px',
                        right: '10px',
                        padding: '4px 12px',
                        backgroundColor: copyFeedback ? 'var(--colors-status-live)' : 'rgba(255, 255, 255, 0.1)',
                        color: copyFeedback ? '#000000' : '#ffffff',
                        fontWeight: 700,
                      }}
                      onClick={() => {
                        navigator.clipboard.writeText(currentCmd);
                        setCopyFeedback(true);
                        setTimeout(() => setCopyFeedback(false), 2000);
                      }}
                    >
                      {copyFeedback ? t('btn_copied') : t('btn_copy_cmd')}
                    </button>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '14px', flexWrap: 'wrap', gap: '8px' }}>
                    <span className="eyebrow-cap" style={{ fontSize: '11px', color: 'var(--colors-muted)' }}>
                      NODE UUID: <strong style={{ color: '#ffffff', fontFamily: 'monospace' }}>{nodeId}</strong>
                    </span>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button
                        className="button-ghost-on-dark button-ghost-sm"
                        style={{ fontSize: '11px', padding: '3px 10px' }}
                        onClick={() => {
                          navigator.clipboard.writeText(nodeId);
                          setCopyFeedback(true);
                          setTimeout(() => setCopyFeedback(false), 2000);
                        }}
                      >
                        📋 Copy UUID
                      </button>
                      <button className="button-ghost-on-dark button-ghost-sm" onClick={() => setOneTimeTokenModal(null)}>
                        {t('cancel_btn')}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })()}



          {/* Modal 1: Add / Edit Notification Channel Modal */}
          {showAddChannelModal && (
            <div className="modal-backdrop-dark">
              <div className="modal-box-dark" style={{ maxWidth: '540px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                  <span className="eyebrow-cap">
                    {editingChannel ? t('modal_edit_channel_title') : t('modal_add_channel_title')}
                  </span>
                  <button
                    style={{ background: 'none', border: 'none', color: '#ffffff', fontSize: '18px', cursor: 'pointer' }}
                    onClick={() => {
                      setShowAddChannelModal(false);
                      setEditingChannel(null);
                    }}
                  >
                    ✕
                  </button>
                </div>

                <form onSubmit={handleSaveChannel}>
                  <div style={{ marginBottom: '16px' }}>
                    <span className="eyebrow-cap" style={{ display: 'block', marginBottom: '6px' }}>{t('channel_name')}</span>
                    <input
                      value={newChannelName}
                      onChange={(e) => setNewChannelName(e.target.value)}
                      placeholder="e.g. Telegram Ops / Feishu Bot"
                      className="spacex-input"
                      required
                    />
                  </div>

                  <div style={{ marginBottom: '16px' }}>
                    <span className="eyebrow-cap" style={{ display: 'block', marginBottom: '8px' }}>{t('channel_type')}</span>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))', gap: '8px' }}>
                      {([
                        { id: 'telegram', label: 'Telegram' },
                        { id: 'discord', label: 'Discord' },
                        { id: 'feishu', label: '飞书 Feishu' },
                        { id: 'dingtalk', label: '钉钉 DingTalk' },
                        { id: 'wecom', label: '企业微信' },
                        { id: 'bark', label: 'Bark (iOS)' },
                        { id: 'serverchan', label: 'Server酱' },
                        { id: 'pushdeer', label: 'PushDeer' },
                        { id: 'slack', label: 'Slack' },
                        { id: 'custom', label: '自定义 HTTP' },
                      ] as const).map((ch) => (
                        <button
                          key={ch.id}
                          type="button"
                          className={`range-capsule-btn ${newAlertChannel === ch.id ? 'active' : ''}`}
                          style={{ width: '100%', height: '32px', fontSize: '10px', textTransform: 'none', padding: '0 6px' }}
                          onClick={() => {
                            setNewAlertChannel(ch.id as any);
                            setTestFeedback(null);
                          }}
                        >
                          {ch.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Telegram Dedicated Fields */}
                  {newAlertChannel === 'telegram' ? (
                    <>
                      <div style={{ marginBottom: '12px' }}>
                        <span className="eyebrow-cap" style={{ display: 'block', marginBottom: '6px' }}>
                          {t('channel_bot_token')} (@BotFather)
                        </span>
                        <input
                          value={newAlertBotToken}
                          onChange={(e) => setNewAlertBotToken(e.target.value)}
                          placeholder="e.g. 123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ"
                          className="spacex-input"
                          required
                        />
                      </div>

                      <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '12px', marginBottom: '16px' }}>
                        <div>
                          <span className="eyebrow-cap" style={{ display: 'block', marginBottom: '6px' }}>
                            {t('channel_chat_id')}
                          </span>
                          <input
                            value={newAlertChatId}
                            onChange={(e) => setNewAlertChatId(e.target.value)}
                            placeholder="e.g. -100123456789 / @my_channel"
                            className="spacex-input"
                            required
                          />
                        </div>
                        <div>
                          <span className="eyebrow-cap" style={{ display: 'block', marginBottom: '6px' }}>
                            {t('channel_api_host')}
                          </span>
                          <input
                            value={newAlertApiHost}
                            onChange={(e) => setNewAlertApiHost(e.target.value)}
                            placeholder="https://api.telegram.org"
                            className="spacex-input"
                          />
                        </div>
                      </div>
                    </>
                  ) : newAlertChannel === 'bark' ? (
                    <div style={{ marginBottom: '16px' }}>
                      <span className="eyebrow-cap" style={{ display: 'block', marginBottom: '6px' }}>
                        Bark {t('channel_webhook_url')} / Device Key
                      </span>
                      <input
                        value={newAlertWebhookUrl}
                        onChange={(e) => setNewAlertWebhookUrl(e.target.value)}
                        placeholder="https://api.day.app/your_device_key"
                        className="spacex-input"
                        required
                      />
                    </div>
                  ) : newAlertChannel === 'serverchan' ? (
                    <div style={{ marginBottom: '16px' }}>
                      <span className="eyebrow-cap" style={{ display: 'block', marginBottom: '6px' }}>
                        Server酱 SendKey / {t('channel_webhook_url')}
                      </span>
                      <input
                        value={newAlertWebhookUrl}
                        onChange={(e) => {
                          const val = e.target.value.trim();
                          if (val.startsWith('SCT') && !val.includes('/')) {
                            setNewAlertWebhookUrl(`https://sctapi.ftqq.com/${val}.send`);
                          } else {
                            setNewAlertWebhookUrl(val);
                          }
                        }}
                        placeholder="SCTxxxxxxxxxxxxxxxxxxxx / https://sctapi.ftqq.com/xxx.send"
                        className="spacex-input"
                        required
                      />
                    </div>
                  ) : newAlertChannel === 'pushdeer' ? (
                    <div style={{ marginBottom: '16px' }}>
                      <span className="eyebrow-cap" style={{ display: 'block', marginBottom: '6px' }}>
                        PushDeer PushKey / {t('channel_webhook_url')}
                      </span>
                      <input
                        value={newAlertWebhookUrl}
                        onChange={(e) => {
                          const val = e.target.value.trim();
                          if (val.startsWith('PDU') && !val.includes('/')) {
                            setNewAlertWebhookUrl(`https://api2.pushdeer.com/message/push?pushkey=${val}`);
                          } else {
                            setNewAlertWebhookUrl(val);
                          }
                        }}
                        placeholder="PDUxxxxxxxxxxxxxxxxxxxx / https://api2.pushdeer.com/..."
                        className="spacex-input"
                        required
                      />
                    </div>
                  ) : newAlertChannel === 'custom' ? (
                    <>
                      <div style={{ display: 'grid', gridTemplateColumns: '100px 1fr', gap: '12px', marginBottom: '12px' }}>
                        <div>
                          <span className="eyebrow-cap" style={{ display: 'block', marginBottom: '6px' }}>METHOD</span>
                          <select
                            value={newAlertMethod}
                            onChange={(e) => setNewAlertMethod(e.target.value as any)}
                            className="spacex-input"
                            style={{ background: '#000000', color: '#ffffff' }}
                          >
                            <option value="POST">POST</option>
                            <option value="GET">GET</option>
                          </select>
                        </div>
                        <div>
                          <span className="eyebrow-cap" style={{ display: 'block', marginBottom: '6px' }}>
                            {t('channel_webhook_url')} (&#123;&#123;node_name&#125;&#125;)
                          </span>
                          <input
                            value={newAlertWebhookUrl}
                            onChange={(e) => setNewAlertWebhookUrl(e.target.value)}
                            placeholder="https://api.example.com/notify?msg={{title}}"
                            className="spacex-input"
                            required
                          />
                        </div>
                      </div>

                      {newAlertMethod === 'POST' && (
                        <>
                          <div style={{ marginBottom: '12px' }}>
                            <span className="eyebrow-cap" style={{ display: 'block', marginBottom: '6px' }}>
                              CONTENT-TYPE
                            </span>
                            <div style={{ display: 'flex', gap: '8px' }}>
                              {(['json', 'form', 'text'] as const).map((ct) => (
                                <button
                                  key={ct}
                                  type="button"
                                  className={`range-capsule-btn ${newAlertContentType === ct ? 'active' : ''}`}
                                  style={{ height: '28px', fontSize: '10px', textTransform: 'uppercase' }}
                                  onClick={() => setNewAlertContentType(ct)}
                                >
                                  {ct}
                                </button>
                              ))}
                            </div>
                          </div>

                          <div style={{ marginBottom: '12px' }}>
                            <span className="eyebrow-cap" style={{ display: 'block', marginBottom: '6px' }}>
                              BODY TEMPLATE (JSON)
                            </span>
                            <textarea
                              value={newAlertBodyTemplate}
                              onChange={(e) => setNewAlertBodyTemplate(e.target.value)}
                              placeholder='{"title":"{{title}}", "msg":"{{message}}", "node":"{{node_name}}"}'
                              className="spacex-input"
                              style={{ height: '70px', resize: 'vertical', fontSize: '11px', fontFamily: 'monospace' }}
                            />
                          </div>
                        </>
                      )}

                      <div style={{ marginBottom: '12px' }}>
                        <span className="eyebrow-cap" style={{ display: 'block', marginBottom: '6px' }}>
                          HEADERS (JSON)
                        </span>
                        <input
                          value={newAlertHeaders}
                          onChange={(e) => setNewAlertHeaders(e.target.value)}
                          placeholder='{"Authorization": "Bearer your_token"}'
                          className="spacex-input"
                        />
                      </div>

                      <div style={{ padding: '8px 12px', background: 'rgba(255, 255, 255, 0.03)', border: '1px solid var(--colors-hairline-on-dark)', borderRadius: '4px', marginBottom: '16px', fontSize: '10px', color: 'var(--colors-muted)' }}>
                        💡 Variables: <code>&#123;&#123;node_name&#125;&#125;</code>, <code>&#123;&#123;event&#125;&#125;</code>, <code>&#123;&#123;title&#125;&#125;</code>, <code>&#123;&#123;message&#125;&#125;</code>, <code>&#123;&#123;time&#125;&#125;</code>
                      </div>
                    </>
                  ) : (
                    <div style={{ marginBottom: '16px' }}>
                      <span className="eyebrow-cap" style={{ display: 'block', marginBottom: '6px' }}>
                        {newAlertChannel.toUpperCase()} {t('channel_webhook_url')}
                      </span>
                      <input
                        value={newAlertWebhookUrl}
                        onChange={(e) => setNewAlertWebhookUrl(e.target.value)}
                        placeholder={
                          newAlertChannel === 'discord'
                            ? 'https://discord.com/api/webhooks/...'
                            : newAlertChannel === 'feishu'
                            ? 'https://open.feishu.cn/open-apis/bot/v2/hook/...'
                            : newAlertChannel === 'dingtalk'
                            ? 'https://oapi.dingtalk.com/robot/send?access_token=...'
                            : newAlertChannel === 'wecom'
                            ? 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=...'
                            : 'https://hooks.slack.com/services/...'
                        }
                        className="spacex-input"
                        required
                      />
                    </div>
                  )}

                  {/* Live Test Feedback Banner */}
                  {testFeedback && (
                    <div style={{
                      padding: '10px 14px',
                      borderRadius: '4px',
                      marginBottom: '16px',
                      fontSize: '11px',
                      fontWeight: 600,
                      backgroundColor: testFeedback.success ? 'rgba(0, 230, 118, 0.1)' : 'rgba(226, 39, 24, 0.1)',
                      border: `1px solid ${testFeedback.success ? '#00e676' : '#e22718'}`,
                      color: testFeedback.success ? '#00e676' : '#e22718',
                    }}>
                      {testFeedback.message}
                    </div>
                  )}

                  <div style={{ padding: '8px 12px', background: 'rgba(0, 230, 118, 0.05)', border: '1px solid rgba(0, 230, 118, 0.2)', borderRadius: '4px', marginBottom: '20px', fontSize: '11px', color: '#00e676' }}>
                    🔒 AES-GCM 256-bit Encrypted Storage
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
                    <button
                      type="button"
                      disabled={testingAlert}
                      className="button-ghost-on-dark button-ghost-sm"
                      style={{ borderColor: '#38bdf8', color: '#38bdf8' }}
                      onClick={handleTestAlert}
                    >
                      {testingAlert ? t('channel_testing') : t('channel_test_btn')}
                    </button>

                    <div style={{ display: 'flex', gap: '12px' }}>
                      <button
                        type="button"
                        className="button-ghost-on-dark button-ghost-sm"
                        onClick={() => {
                          setShowAddChannelModal(false);
                          setEditingChannel(null);
                        }}
                      >
                        {t('cancel_btn')}
                      </button>
                      <button
                        type="submit"
                        disabled={creatingAlert}
                        className="button-ghost-on-dark button-ghost-sm"
                        style={{ backgroundColor: '#ffffff', color: '#000000', fontWeight: 700 }}
                      >
                        {creatingAlert ? '...' : t('channel_save_btn')}
                      </button>
                    </div>
                  </div>
                </form>
              </div>
            </div>
          )}

          {/* Modal 2: Add / Edit Alert Policy Modal (Multi-Condition Compound Support) */}
          {showAddRuleModal && (
            <div className="modal-backdrop-dark">
              <div className="modal-box-dark" style={{ maxWidth: '620px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                  <div>
                    <span className="eyebrow-cap">
                      {editingPolicy ? t('modal_edit_policy_title') : t('modal_add_policy_title')}
                    </span>
                  </div>
                  <button
                    style={{ background: 'none', border: 'none', color: '#ffffff', fontSize: '18px', cursor: 'pointer' }}
                    onClick={() => {
                      setShowAddRuleModal(false);
                      setEditingPolicy(null);
                    }}
                  >
                    ✕
                  </button>
                </div>

                <form onSubmit={handleSavePolicy}>
                  <div style={{ marginBottom: '16px' }}>
                    <span className="eyebrow-cap" style={{ display: 'block', marginBottom: '6px' }}>{t('policy_name')}</span>
                    <input
                      value={newRuleName}
                      onChange={(e) => setNewRuleName(e.target.value)}
                      placeholder="e.g. Production Compound Policy"
                      className="spacex-input"
                      required
                    />
                  </div>

                  {/* Multi-Condition Switch & Threshold Rows */}
                  <div style={{ marginBottom: '16px' }}>
                    <span className="eyebrow-cap" style={{ display: 'block', marginBottom: '8px' }}>
                      {t('policy_conditions_heading')}
                    </span>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                      {/* Condition 1: Offline */}
                      <div style={{ padding: '10px 12px', background: condOfflineEnabled ? 'rgba(226, 39, 24, 0.05)' : 'rgba(255, 255, 255, 0.02)', border: `1px solid ${condOfflineEnabled ? 'rgba(226, 39, 24, 0.3)' : 'var(--colors-hairline-on-dark)'}`, borderRadius: '4px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontWeight: 600, fontSize: '12px' }}>
                            <input
                              type="checkbox"
                              checked={condOfflineEnabled}
                              onChange={(e) => setCondOfflineEnabled(e.target.checked)}
                            />
                            <span>⚠️ {t('policy_cond_offline')}</span>
                          </label>
                          {condOfflineEnabled && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px' }}>
                              <span style={{ color: 'var(--colors-muted)' }}>&gt;</span>
                              <input
                                type="number"
                                value={condOfflineDurationSec}
                                onChange={(e) => setCondOfflineDurationSec(parseInt(e.target.value) || 90)}
                                min={10}
                                max={3600}
                                className="spacex-input"
                                style={{ width: '70px', padding: '3px 6px', fontSize: '11px' }}
                              />
                              <span style={{ color: 'var(--colors-muted)' }}>s</span>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Condition 2: CPU */}
                      <div style={{ padding: '10px 12px', background: condCpuEnabled ? 'rgba(255, 170, 0, 0.05)' : 'rgba(255, 255, 255, 0.02)', border: `1px solid ${condCpuEnabled ? 'rgba(255, 170, 0, 0.3)' : 'var(--colors-hairline-on-dark)'}`, borderRadius: '4px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontWeight: 600, fontSize: '12px' }}>
                            <input
                              type="checkbox"
                              checked={condCpuEnabled}
                              onChange={(e) => setCondCpuEnabled(e.target.checked)}
                            />
                            <span>🔥 {t('policy_cond_cpu')}</span>
                          </label>
                          {condCpuEnabled && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '11px' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                <span style={{ color: 'var(--colors-muted)' }}>&ge;</span>
                                <input
                                  type="number"
                                  value={condCpuThreshold}
                                  onChange={(e) => setCondCpuThreshold(parseInt(e.target.value) || 85)}
                                  min={1}
                                  max={100}
                                  className="spacex-input"
                                  style={{ width: '60px', padding: '3px 6px', fontSize: '11px' }}
                                />
                                <span>%</span>
                              </div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                <span style={{ color: 'var(--colors-muted)' }}>{t('policy_cond_offline_duration')}</span>
                                <input
                                  type="number"
                                  value={condCpuDurationSec}
                                  onChange={(e) => setCondCpuDurationSec(parseInt(e.target.value) || 60)}
                                  min={0}
                                  max={3600}
                                  className="spacex-input"
                                  style={{ width: '60px', padding: '3px 6px', fontSize: '11px' }}
                                />
                                <span>s</span>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Condition 3: Memory */}
                      <div style={{ padding: '10px 12px', background: condMemoryEnabled ? 'rgba(56, 189, 248, 0.05)' : 'rgba(255, 255, 255, 0.02)', border: `1px solid ${condMemoryEnabled ? 'rgba(56, 189, 248, 0.3)' : 'var(--colors-hairline-on-dark)'}`, borderRadius: '4px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontWeight: 600, fontSize: '12px' }}>
                            <input
                              type="checkbox"
                              checked={condMemoryEnabled}
                              onChange={(e) => setCondMemoryEnabled(e.target.checked)}
                            />
                            <span>🧠 {t('policy_cond_mem')}</span>
                          </label>
                          {condMemoryEnabled && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '11px' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                <span style={{ color: 'var(--colors-muted)' }}>&ge;</span>
                                <input
                                  type="number"
                                  value={condMemoryThreshold}
                                  onChange={(e) => setCondMemoryThreshold(parseInt(e.target.value) || 90)}
                                  min={1}
                                  max={100}
                                  className="spacex-input"
                                  style={{ width: '60px', padding: '3px 6px', fontSize: '11px' }}
                                />
                                <span>%</span>
                              </div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                <span style={{ color: 'var(--colors-muted)' }}>{t('policy_cond_offline_duration')}</span>
                                <input
                                  type="number"
                                  value={condMemoryDurationSec}
                                  onChange={(e) => setCondMemoryDurationSec(parseInt(e.target.value) || 60)}
                                  min={0}
                                  max={3600}
                                  className="spacex-input"
                                  style={{ width: '60px', padding: '3px 6px', fontSize: '11px' }}
                                />
                                <span>s</span>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Condition 4: Disk */}
                      <div style={{ padding: '10px 12px', background: condDiskEnabled ? 'rgba(192, 132, 252, 0.05)' : 'rgba(255, 255, 255, 0.02)', border: `1px solid ${condDiskEnabled ? 'rgba(192, 132, 252, 0.3)' : 'var(--colors-hairline-on-dark)'}`, borderRadius: '4px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontWeight: 600, fontSize: '12px' }}>
                            <input
                              type="checkbox"
                              checked={condDiskEnabled}
                              onChange={(e) => setCondDiskEnabled(e.target.checked)}
                            />
                            <span>💾 {t('policy_cond_disk')}</span>
                          </label>
                          {condDiskEnabled && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px' }}>
                              <span style={{ color: 'var(--colors-muted)' }}>&ge;</span>
                              <input
                                type="number"
                                value={condDiskThreshold}
                                onChange={(e) => setCondDiskThreshold(parseInt(e.target.value) || 90)}
                                min={1}
                                max={100}
                                className="spacex-input"
                                style={{ width: '60px', padding: '3px 6px', fontSize: '11px' }}
                              />
                              <span>%</span>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Condition 5: Expiry */}
                      <div style={{ padding: '10px 12px', background: condExpiryEnabled ? 'rgba(251, 191, 36, 0.05)' : 'rgba(255, 255, 255, 0.02)', border: `1px solid ${condExpiryEnabled ? 'rgba(251, 191, 36, 0.3)' : 'var(--colors-hairline-on-dark)'}`, borderRadius: '4px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontWeight: 600, fontSize: '12px' }}>
                            <input
                              type="checkbox"
                              checked={condExpiryEnabled}
                              onChange={(e) => setCondExpiryEnabled(e.target.checked)}
                            />
                            <span>📅 {t('policy_cond_expiry')}</span>
                          </label>
                          {condExpiryEnabled && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px' }}>
                              <span style={{ color: 'var(--colors-muted)' }}>&le;</span>
                              <input
                                type="number"
                                value={condExpiryDays}
                                onChange={(e) => setCondExpiryDays(parseInt(e.target.value) || 7)}
                                min={1}
                                max={30}
                                className="spacex-input"
                                style={{ width: '60px', padding: '3px 6px', fontSize: '11px' }}
                              />
                              <span>d</span>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Target Notification Channels Multi-Select */}
                  <div style={{ marginBottom: '20px' }}>
                    <span className="eyebrow-cap" style={{ display: 'block', marginBottom: '8px' }}>
                      {t('policy_channels_heading')} ({t('policy_channels_hint')})
                    </span>
                    {alertRules.filter(r => r.type === 'channel' || r.type === 'webhook').length === 0 ? (
                      <div style={{ padding: '10px 12px', background: 'rgba(255, 255, 255, 0.02)', border: '1px solid var(--colors-hairline-on-dark)', borderRadius: '4px', fontSize: '11px', color: 'var(--colors-muted)' }}>
                        {t('no_channels_configured')}
                      </div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '130px', overflowY: 'auto', padding: '8px', background: 'rgba(0, 0, 0, 0.4)', border: '1px solid var(--colors-hairline-on-dark)', borderRadius: '4px' }}>
                        {alertRules.filter(r => r.type === 'channel' || r.type === 'webhook').map((c) => {
                          let cConfig: any = {};
                          try { cConfig = c.config_json ? JSON.parse(c.config_json) : {}; } catch { cConfig = {}; }
                          const isChecked = newRuleChannelIds.includes(c.id);
                          return (
                            <label key={c.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '12px' }}>
                              <input
                                type="checkbox"
                                checked={isChecked}
                                onChange={(e) => {
                                  if (e.target.checked) {
                                    setNewRuleChannelIds([...newRuleChannelIds, c.id]);
                                  } else {
                                    setNewRuleChannelIds(newRuleChannelIds.filter(id => id !== c.id));
                                  }
                                }}
                              />
                              <span>📢 {cConfig.name || t('channels_title')} ({cConfig.channel?.toUpperCase() || 'WEBHOOK'})</span>
                            </label>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
                    <button
                      type="button"
                      className="button-ghost-on-dark button-ghost-sm"
                      onClick={() => {
                        setShowAddRuleModal(false);
                        setEditingPolicy(null);
                      }}
                    >
                      {t('cancel_btn')}
                    </button>
                    <button
                      type="submit"
                      disabled={creatingAlert}
                      className="button-ghost-on-dark button-ghost-sm"
                      style={{ backgroundColor: '#ffffff', color: '#000000', fontWeight: 700 }}
                    >
                      {creatingAlert ? '...' : t('policy_save_btn')}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
