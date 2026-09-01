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
  createAlertRule,
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

  const [showAddAlertModal, setShowAddAlertModal] = useState(false);
  const [newAlertType, setNewAlertType] = useState<'webhook' | 'offline' | 'cpu' | 'memory' | 'disk'>('webhook');
  const [newAlertNodeId, setNewAlertNodeId] = useState<string>('');
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
  const [newAlertThreshold, setNewAlertThreshold] = useState<number>(85);
  const [newAlertDurationSec, setNewAlertDurationSec] = useState<number>(60);
  const [creatingAlert, setCreatingAlert] = useState(false);
  const [testingAlert, setTestingAlert] = useState(false);
  const [testFeedback, setTestFeedback] = useState<{ success: boolean; message: string } | null>(null);

  const [showAddModal, setShowAddModal] = useState(false);
  const [newNodeName, setNewNodeName] = useState('');
  const [newNodeResetDay, setNewNodeResetDay] = useState(1);
  const [newNodeQuotaGb, setNewNodeQuotaGb] = useState('');
  const [newNodeExpiresAt, setNewNodeExpiresAt] = useState('');
  const [newNodeNote, setNewNodeNote] = useState('');
  const [newNodePrice, setNewNodePrice] = useState('');
  const [newNodeCurrency, setNewNodeCurrency] = useState('USD');
  const [newNodeCycle, setNewNodeCycle] = useState('monthly');
  const [newNodeAutoRenewal, setNewNodeAutoRenewal] = useState(true);

  const [editingNode, setEditingNode] = useState<{
    id: string;
    name: string;
    traffic_reset_day: number;
    traffic_quota_gb: string;
    expires_at: string;
    note: string;
    hidden: boolean;
    plan_price: string;
    plan_currency: string;
    billing_cycle: string;
    auto_renewal: boolean;
  } | null>(null);
  const [updatingNode, setUpdatingNode] = useState(false);

  const [oneTimeTokenModal, setOneTimeTokenModal] = useState<{ nodeId: string; rawToken: string; warning?: string } | null>(null);
  const [adminBannerWarning, setAdminBannerWarning] = useState<string | null>(null);
  const [cmdTab, setCmdTab] = useState<'binary' | 'docker' | 'systemd' | 'raw'>('binary');
  const [copyFeedback, setCopyFeedback] = useState(false);

  const [probeModalNode, setProbeModalNode] = useState<{ id: string; name: string } | null>(null);
  const [editingConfig, setEditingConfig] = useState<NodeServerConfig | null>(null);
  const [savingConfig, setSavingConfig] = useState(false);
  const [newProbeId, setNewProbeId] = useState('');
  const [newProbeTarget, setNewProbeTarget] = useState('');
  const [newProbeProtocol, setNewProbeProtocol] = useState<'icmp' | 'tcp'>('icmp');
  const [newProbePort, setNewProbePort] = useState<number>(80);

  async function openProbeModal(node: { id: string; name: string }) {
    setProbeModalNode(node);
    try {
      const res = await fetchNodeConfig(node.id);
      setEditingConfig({
        sample_interval_sec: res.config?.sample_interval_sec ?? 30,
        stream_interval_sec: res.config?.stream_interval_sec ?? 30,
        probe_interval_sec: res.config?.probe_interval_sec ?? 60,
        network_interface: res.config?.network_interface ?? 'auto',
        probes: Array.isArray(res.config?.probes) && res.config.probes.length > 0 ? res.config.probes : PROBE_PRESETS.china_3net,
      });
    } catch {
      setEditingConfig({
        sample_interval_sec: 30,
        stream_interval_sec: 30,
        probe_interval_sec: 60,
        network_interface: 'auto',
        probes: PROBE_PRESETS.china_3net,
      });
    }
  }

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

  async function handleSaveProbeConfig() {
    if (!probeModalNode || !editingConfig) return;
    setSavingConfig(true);
    try {
      const payloadToSave: NodeServerConfig = {
        sample_interval_sec: editingConfig.sample_interval_sec ?? 30,
        stream_interval_sec: editingConfig.stream_interval_sec ?? 30,
        probe_interval_sec: editingConfig.probe_interval_sec ?? 60,
        network_interface: editingConfig.network_interface ?? 'auto',
        probes: editingConfig.probes || [],
      };
      await updateNodeConfig(probeModalNode.id, payloadToSave);
      setProbeModalNode(null);
      setEditingConfig(null);
      alert('探针测速配置已更新并实时推送给节点！');
    } catch (err: any) {
      alert(err.message || '更新探针配置失败');
    } finally {
      setSavingConfig(false);
    }
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

  async function handleCreateAlert(e: React.FormEvent) {
    e.preventDefault();
    setCreatingAlert(true);
    try {
      let config: Record<string, any> = {};
      if (newAlertType === 'webhook') {
        if (newAlertChannel === 'telegram') {
          if (!newAlertBotToken || !newAlertChatId) {
            alert('Telegram Bot Token 与 Chat ID 均为必填项');
            return;
          }
        } else if (newAlertChannel !== 'custom' && !newAlertWebhookUrl) {
          alert('Webhook URL 是必填项');
          return;
        }

        let headersObj: Record<string, string> | undefined = undefined;
        if (newAlertHeaders.trim()) {
          try {
            headersObj = JSON.parse(newAlertHeaders.trim());
          } catch {
            alert('Custom Headers 必须是合法的 JSON 格式 (如 {"Authorization": "Bearer ..."})');
            return;
          }
        }

        config = {
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
      }

      await createAlertRule({
        node_id: newAlertNodeId || null,
        type: newAlertType,
        threshold: newAlertType === 'webhook' || newAlertType === 'offline' ? null : newAlertThreshold,
        duration_sec: newAlertType === 'offline' ? 90 : newAlertDurationSec,
        enabled: 1,
        config,
      });

      setShowAddAlertModal(false);
      setNewAlertWebhookUrl('');
      setNewAlertBotToken('');
      setNewAlertChatId('');
      setNewAlertApiHost('');
      setNewAlertHeaders('');
      setNewAlertUrlTemplate('');
      setNewAlertBodyTemplate('');
      setTestFeedback(null);
      loadAlertRules();
    } catch (err: any) {
      alert(err.message || 'Failed to create alert rule');
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
      setOneTimeTokenModal({
        nodeId: res.node.id,
        rawToken: res.rawToken,
      });
      refetchNodes();
    } catch (err: any) {
      alert(err.message);
    }
  }

  function openEditModal(n: any) {
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
      setEditingNode(null);
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
                  {t('admin_nodes_title')} ({adminNodes.length})
                </button>
                <button
                  type="button"
                  className={`range-capsule-btn ${activeTab === 'alerts' ? 'active' : ''}`}
                  onClick={() => setActiveTab('alerts')}
                >
                  告警策略与推送 ({alertRules.length})
                </button>
                <button
                  type="button"
                  className={`range-capsule-btn ${activeTab === 'events' ? 'active' : ''}`}
                  onClick={() => setActiveTab('events')}
                >
                  审计事件
                </button>
              </div>
            </div>
            <div style={{ display: 'flex', gap: '12px' }}>
              {activeTab === 'nodes' && (
                <button className="button-ghost-on-dark button-ghost-sm" onClick={() => setShowAddModal(true)}>
                  {t('create_node_btn')}
                </button>
              )}
              {activeTab === 'alerts' && (
                <button className="button-ghost-on-dark button-ghost-sm" onClick={() => setShowAddAlertModal(true)}>
                  + 添加告警 / 推送渠道
                </button>
              )}
              {activeTab === 'events' && (
                <button className="button-ghost-on-dark button-ghost-sm" onClick={loadSystemEvents}>
                  {loadingEvents ? '刷新中...' : '刷新事件 ⟳'}
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
                            onClick={() => openEditModal(n)}
                          >
                            {t('btn_edit')}
                          </button>
                          <button
                            className="button-ghost-on-dark button-ghost-sm"
                            onClick={() => openProbeModal({ id: n.id, name: n.name })}
                          >
                            探针
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

          {/* TAB 2: Alerts & Webhooks */}
          {activeTab === 'alerts' && (
            <div className="map-band" style={{ padding: 0 }}>
              <table className="spacex-table">
                <thead>
                  <tr>
                    <th>类型 / TYPE</th>
                    <th>作用范围 / SCOPE</th>
                    <th>触发条件 / 渠道详情</th>
                    <th>安全凭据 / CREDENTIAL</th>
                    <th>状态 / STATUS</th>
                    <th>操作 / ACTIONS</th>
                  </tr>
                </thead>
                <tbody>
                  {loadingAlerts ? (
                    <tr>
                      <td colSpan={6} style={{ textAlign: 'center', padding: '32px', color: 'var(--colors-muted)' }}>
                        正在加载告警规则...
                      </td>
                    </tr>
                  ) : alertRules.length === 0 ? (
                    <tr>
                      <td colSpan={6} style={{ textAlign: 'center', padding: '32px', color: 'var(--colors-muted)' }}>
                        暂无自定义告警策略或 Webhook 推送渠道（默认已内置 90 秒节点离线与恢复告警）。
                      </td>
                    </tr>
                  ) : (
                    alertRules.map((rule) => {
                      let parsedConfig: any = {};
                      try {
                        parsedConfig = rule.config_json ? JSON.parse(rule.config_json) : {};
                      } catch {
                        parsedConfig = {};
                      }

                      const targetNode = rule.node_id ? adminNodes.find((n) => n.id === rule.node_id) : null;
                      const scopeText = targetNode ? `${targetNode.name} (${targetNode.id.substring(0, 8)}...)` : '全量节点 (GLOBAL)';

                      return (
                        <tr key={rule.id}>
                          <td>
                            <span className="spacex-chip" style={{
                              borderColor: rule.type === 'webhook' ? '#00e676' : rule.type === 'offline' ? '#e22718' : '#38bdf8',
                              color: rule.type === 'webhook' ? '#00e676' : rule.type === 'offline' ? '#e22718' : '#38bdf8',
                            }}>
                              {rule.type.toUpperCase()}
                            </span>
                          </td>
                          <td>
                            <span style={{ fontSize: '12px', fontWeight: 600 }}>{scopeText}</span>
                          </td>
                          <td>
                            {rule.type === 'webhook' ? (
                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <strong style={{ textTransform: 'uppercase' }}>{parsedConfig.channel || 'WEBHOOK'}</strong>
                                <span style={{ color: 'var(--colors-muted)', fontSize: '11px' }}>
                                  {parsedConfig.is_encrypted ? '🔒 AES-GCM 已加密' : 'PLAIN'}
                                </span>
                              </div>
                            ) : rule.type === 'offline' ? (
                              <span>离线持续 &gt; {rule.duration_sec || 90} 秒</span>
                            ) : (
                              <span>
                                {rule.type.toUpperCase()} &gt; {rule.threshold}% (持续 {rule.duration_sec}s)
                              </span>
                            )}
                          </td>
                          <td>
                            {parsedConfig.secret_key ? (
                              <span style={{ fontFamily: 'monospace', fontSize: '10px', color: 'var(--colors-muted)' }}>
                                {parsedConfig.secret_key.substring(0, 20)}...
                              </span>
                            ) : (
                              <span style={{ color: 'var(--colors-muted)', fontSize: '11px' }}>-</span>
                            )}
                          </td>
                          <td>
                            <span className={`spacex-chip ${rule.enabled ? 'spacex-chip-active' : ''}`}>
                              {rule.enabled ? 'ACTIVE' : 'DISABLED'}
                            </span>
                          </td>
                          <td>
                            <button
                              className="button-ghost-on-dark button-ghost-sm button-ghost-danger"
                              onClick={() => handleDeleteAlert(rule.id)}
                            >
                              {t('btn_delete')}
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
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
                          <td>{formatBeijingDate(evt.created_at_ms)}</td>
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
                              {evt.payload_json || '-'}
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

                  <div style={{ marginBottom: '24px' }}>
                    <span className="eyebrow-cap" style={{ display: 'block', marginBottom: '8px' }}>Note / 备注 (Optional)</span>
                    <input
                      value={newNodeNote}
                      onChange={(e) => setNewNodeNote(e.target.value)}
                      placeholder="e.g. Racknerd 2C2G US-West"
                      className="spacex-input"
                    />
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

          {/* Edit Node Modal */}
          {editingNode && (
            <div className="modal-backdrop-dark">
              <div className="modal-box-dark">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                  <div>
                    <span className="eyebrow-cap">{t('edit_node_title')}</span>
                    <h3 style={{ fontSize: '18px', fontWeight: 700, marginTop: '4px' }}>{editingNode.name}</h3>
                  </div>
                  <button
                    style={{ background: 'none', border: 'none', color: '#ffffff', fontSize: '18px', cursor: 'pointer' }}
                    onClick={() => setEditingNode(null)}
                  >
                    ✕
                  </button>
                </div>

                <form onSubmit={handleUpdateNode}>
                  <div style={{ marginBottom: '16px' }}>
                    <span className="eyebrow-cap" style={{ display: 'block', marginBottom: '8px' }}>{t('node_name_label')}</span>
                    <input
                      value={editingNode.name}
                      onChange={(e) => setEditingNode({ ...editingNode, name: e.target.value })}
                      className="spacex-input"
                      placeholder="e.g. TOKYO-01"
                      required
                    />
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
                    <div>
                      <span className="eyebrow-cap" style={{ display: 'block', marginBottom: '8px' }}>{t('reset_day_label')}</span>
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
                      <span className="eyebrow-cap" style={{ display: 'block', marginBottom: '8px' }}>{t('quota_gb_label')}</span>
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

                  {/* Finance / Price & Currency */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
                    <div>
                      <span className="eyebrow-cap" style={{ display: 'block', marginBottom: '8px' }}>服务器价格 / Price (Optional)</span>
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
                      <span className="eyebrow-cap" style={{ display: 'block', marginBottom: '8px' }}>结算币种 / Currency</span>
                      <select
                        value={editingNode.plan_currency}
                        onChange={(e) => setEditingNode({ ...editingNode, plan_currency: e.target.value })}
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
                        value={editingNode.billing_cycle}
                        onChange={(e) => setEditingNode({ ...editingNode, billing_cycle: e.target.value })}
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

                  <div style={{ marginBottom: '16px' }}>
                    <span className="eyebrow-cap" style={{ display: 'block', marginBottom: '8px' }}>{t('th_expire')} (Optional)</span>
                    <input
                      value={editingNode.expires_at}
                      onChange={(e) => setEditingNode({ ...editingNode, expires_at: e.target.value })}
                      type="date"
                      className="spacex-input"
                    />
                  </div>

                  <div style={{ marginBottom: '16px' }}>
                    <span className="eyebrow-cap" style={{ display: 'block', marginBottom: '8px' }}>Note / 备注 (Optional)</span>
                    <input
                      value={editingNode.note}
                      onChange={(e) => setEditingNode({ ...editingNode, note: e.target.value })}
                      placeholder="e.g. 搬瓦工 CN2-GIA 2C2G"
                      className="spacex-input"
                    />
                  </div>

                  <div style={{ marginBottom: '24px', display: 'flex', alignItems: 'center', gap: '10px' }}>
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

                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
                    <button type="button" className="button-ghost-on-dark button-ghost-sm" onClick={() => setEditingNode(null)}>
                      {t('cancel_btn')}
                    </button>
                    <button
                      type="submit"
                      disabled={updatingNode}
                      className="button-ghost-on-dark button-ghost-sm"
                      style={{ backgroundColor: '#ffffff', color: '#000000', fontWeight: 700 }}
                    >
                      {updatingNode ? '正在保存...' : t('save_node_btn')}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}

          {/* Token Modal with Multi-Command Generator */}
          {oneTimeTokenModal && (() => {
            const serverUrl = window.location.origin;
            const nodeId = oneTimeTokenModal.nodeId;
            const token = oneTimeTokenModal.rawToken;

            const binaryCmd = `./edgemon-agent --server ${serverUrl} --id ${nodeId} --token ${token}`;
            const dockerCmd = `docker run -d --name edgemon --restart always --net=host -v /proc:/host/proc:ro -v /sys:/host/sys:ro dooooling/edgemon-agent:latest --server ${serverUrl} --id ${nodeId} --token ${token}`;
            const systemdUnit = `[Unit]
Description=EdgeMon Telemetry Agent Daemon
After=network.target

[Service]
Type=simple
ExecStart=/usr/local/bin/edgemon-agent --server ${serverUrl} --id ${nodeId} --token ${token}
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target`;

            return (
              <div className="modal-backdrop-dark">
                <div className="modal-box-dark" style={{ maxWidth: '640px' }}>
                  <h3 className="display-lg" style={{ fontSize: '18px', margin: '0 0 8px 0', color: 'var(--colors-status-live)' }}>
                    🔑 {t('token_modal_title')}
                  </h3>
                  <p className="caption" style={{ color: 'var(--colors-status-alert)' }}>
                    {t('token_notice')}
                  </p>

                  {oneTimeTokenModal.warning && (
                    <div style={{
                      padding: '8px 12px',
                      backgroundColor: 'rgba(255, 170, 0, 0.1)',
                      border: '1px solid #ffaa00',
                      borderRadius: '4px',
                      margin: '12px 0',
                      fontSize: '11px',
                      color: '#ffaa00'
                    }}>
                      ⚠️ WARNING: {oneTimeTokenModal.warning} — Active agent socket disconnect RPC timed out. Existing stream will be evicted on next verification.
                    </div>
                  )}

                  {/* Command Tab Selector */}
                  <div className="range-capsules" style={{ margin: '16px 0 12px 0' }}>
                    <button
                      className={`range-capsule-btn ${cmdTab === 'binary' ? 'active' : ''}`}
                      onClick={() => setCmdTab('binary')}
                    >
                      {t('cmd_binary')}
                    </button>
                    <button
                      className={`range-capsule-btn ${cmdTab === 'docker' ? 'active' : ''}`}
                      onClick={() => setCmdTab('docker')}
                    >
                      {t('cmd_docker')}
                    </button>
                    <button
                      className={`range-capsule-btn ${cmdTab === 'systemd' ? 'active' : ''}`}
                      onClick={() => setCmdTab('systemd')}
                    >
                      {t('cmd_systemd_unit')}
                    </button>
                    <button
                      className={`range-capsule-btn ${cmdTab === 'raw' ? 'active' : ''}`}
                      onClick={() => setCmdTab('raw')}
                    >
                      Raw Token
                    </button>
                  </div>

                  {/* Command Content Box */}
                  <div style={{ position: 'relative' }}>
                    {cmdTab === 'binary' && (
                      <div className="token-view-chassis" style={{ margin: 0, paddingRight: '90px' }}>
                        {binaryCmd}
                      </div>
                    )}
                    {cmdTab === 'docker' && (
                      <div className="token-view-chassis" style={{ margin: 0, paddingRight: '90px' }}>
                        {dockerCmd}
                      </div>
                    )}
                    {cmdTab === 'systemd' && (
                      <pre className="token-view-chassis" style={{ margin: 0, paddingRight: '90px', whiteSpace: 'pre-wrap', fontSize: '12px' }}>
                        {systemdUnit}
                      </pre>
                    )}
                    {cmdTab === 'raw' && (
                      <div className="token-view-chassis" style={{ margin: 0, paddingRight: '90px' }}>
                        {token}
                      </div>
                    )}

                    {/* Copy Button */}
                    <button
                      className="button-ghost-on-dark button-ghost-sm"
                      style={{
                        position: 'absolute',
                        top: '12px',
                        right: '12px',
                        padding: '4px 12px',
                        backgroundColor: copyFeedback ? 'var(--colors-status-live)' : 'rgba(255, 255, 255, 0.1)',
                        color: copyFeedback ? '#000000' : '#ffffff',
                        fontWeight: 700,
                      }}
                      onClick={() => {
                        const contentToCopy =
                          cmdTab === 'binary'
                            ? binaryCmd
                            : cmdTab === 'docker'
                            ? dockerCmd
                            : cmdTab === 'systemd'
                            ? systemdUnit
                            : token;
                        navigator.clipboard.writeText(contentToCopy);
                        setCopyFeedback(true);
                        setTimeout(() => setCopyFeedback(false), 2000);
                      }}
                    >
                      {copyFeedback ? t('btn_copied') : t('btn_copy_cmd')}
                    </button>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '12px' }}>
                    <span className="eyebrow-cap" style={{ fontSize: '10px' }}>
                      NODE UUID: {nodeId}
                    </span>
                    <button
                      style={{ background: 'none', border: 'none', color: 'var(--colors-muted)', fontSize: '11px', cursor: 'pointer', textDecoration: 'underline' }}
                      onClick={() => {
                        navigator.clipboard.writeText(nodeId);
                        setCopyFeedback(true);
                        setTimeout(() => setCopyFeedback(false), 2000);
                      }}
                    >
                      Copy UUID
                    </button>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '24px' }}>
                    <button className="button-ghost-on-dark" onClick={() => setOneTimeTokenModal(null)}>
                      {t('save_node_btn')}
                    </button>
                  </div>
                </div>
              </div>
            );
          })()}

          {/* Probe Configuration Modal */}
          {probeModalNode && editingConfig && (
            <div className="modal-backdrop-dark">
              <div className="modal-box-dark" style={{ maxWidth: '640px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                  <div>
                    <span className="eyebrow-cap">{t('probes_title')} // {probeModalNode.name}</span>
                    <h3 style={{ fontSize: '18px', fontWeight: 700, marginTop: '4px' }}>网络连通性雷达探针配置</h3>
                  </div>
                  <button
                    style={{ background: 'none', border: 'none', color: '#ffffff', fontSize: '18px', cursor: 'pointer' }}
                    onClick={() => {
                      setProbeModalNode(null);
                      setEditingConfig(null);
                    }}
                  >
                    ✕
                  </button>
                </div>

                {/* Quick Presets Bar */}
                <div style={{ marginBottom: '20px', padding: '12px', background: 'rgba(255, 255, 255, 0.02)', borderRadius: '6px', border: '1px solid var(--colors-hairline-on-dark)' }}>
                  <span className="eyebrow-cap" style={{ fontSize: '10px', display: 'block', marginBottom: '8px' }}>
                    {t('probe_presets')}
                  </span>
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      className="button-ghost-on-dark button-ghost-sm"
                      style={{ borderColor: '#38bdf8', color: '#38bdf8' }}
                      onClick={() => handleApplyPreset('china_3net')}
                    >
                      🇨🇳 {t('preset_china_3net')}
                    </button>
                    <button
                      type="button"
                      className="button-ghost-on-dark button-ghost-sm"
                      onClick={() => handleApplyPreset('global_infra')}
                    >
                      🌐 {t('preset_global_infra')}
                    </button>
                    <button
                      type="button"
                      className="button-ghost-on-dark button-ghost-sm"
                      onClick={() => handleApplyPreset('minimal_ping')}
                    >
                      ⚡ {t('preset_minimal_ping')}
                    </button>
                  </div>
                </div>

                {/* Probes List */}
                <div style={{ marginBottom: '20px' }}>
                  <span className="eyebrow-cap" style={{ fontSize: '11px', display: 'block', marginBottom: '8px' }}>
                    已配置探测目标 ({(editingConfig.probes || []).length})
                  </span>
                  {(!editingConfig.probes || editingConfig.probes.length === 0) ? (
                    <div style={{ padding: '16px', textAlign: 'center', color: 'var(--colors-muted)', fontSize: '12px', border: '1px dashed var(--colors-hairline-on-dark)', borderRadius: '4px' }}>
                      暂未配置探测目标，请点击上方预设或手动添加。
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '200px', overflowY: 'auto' }}>
                      {editingConfig.probes.map((p, idx) => (
                        <div
                          key={p.id + idx}
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            padding: '8px 12px',
                            background: 'rgba(255, 255, 255, 0.03)',
                            borderRadius: '4px',
                            border: '1px solid var(--colors-hairline-on-dark)',
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                            <span className="spacex-chip" style={{ fontSize: '10px' }}>{p.protocol.toUpperCase()}</span>
                            <span style={{ fontWeight: 600, fontSize: '12px' }}>{p.id}</span>
                            <span style={{ color: 'var(--colors-muted)', fontSize: '11px' }}>
                              ➔ {p.target}{p.port ? `:${p.port}` : ''}
                            </span>
                          </div>
                          <button
                            type="button"
                            className="button-ghost-on-dark button-ghost-sm button-ghost-danger"
                            style={{ padding: '2px 8px', minHeight: 'auto', fontSize: '11px' }}
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
                <div style={{ padding: '12px', background: 'rgba(255, 255, 255, 0.02)', borderRadius: '6px', border: '1px solid var(--colors-hairline-on-dark)', marginBottom: '20px' }}>
                  <span className="eyebrow-cap" style={{ fontSize: '10px', display: 'block', marginBottom: '8px' }}>
                    + 添加自定义探测目标
                  </span>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.5fr 80px 1fr', gap: '8px', alignItems: 'center' }}>
                    <input
                      placeholder="标识 (如 ct-hk)"
                      value={newProbeId}
                      onChange={(e) => setNewProbeId(e.target.value)}
                      className="spacex-input"
                      style={{ fontSize: '12px', padding: '6px 8px' }}
                    />
                    <input
                      placeholder="IP 或域名 (如 1.1.1.1)"
                      value={newProbeTarget}
                      onChange={(e) => setNewProbeTarget(e.target.value)}
                      className="spacex-input"
                      style={{ fontSize: '12px', padding: '6px 8px' }}
                    />
                    <select
                      value={newProbeProtocol}
                      onChange={(e) => setNewProbeProtocol(e.target.value as any)}
                      className="spacex-input"
                      style={{ fontSize: '12px', padding: '6px 8px', background: '#000000', color: '#ffffff' }}
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
                        style={{ fontSize: '12px', padding: '6px 8px' }}
                      />
                    ) : (
                      <button
                        type="button"
                        className="button-ghost-on-dark button-ghost-sm"
                        onClick={handleAddProbe}
                        style={{ width: '100%', justifyContent: 'center' }}
                      >
                        + 添加
                      </button>
                    )}
                  </div>
                  {newProbeProtocol === 'tcp' && (
                    <div style={{ marginTop: '8px', display: 'flex', justifyContent: 'flex-end' }}>
                      <button
                        type="button"
                        className="button-ghost-on-dark button-ghost-sm"
                        onClick={handleAddProbe}
                      >
                        + 确认添加此 TCP 探测
                      </button>
                    </div>
                  )}
                </div>

                {/* Footer Save / Cancel */}
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
                  <button
                    type="button"
                    className="button-ghost-on-dark button-ghost-sm"
                    onClick={() => {
                      setProbeModalNode(null);
                      setEditingConfig(null);
                    }}
                  >
                    {t('cancel_btn')}
                  </button>
                  <button
                    type="button"
                    disabled={savingConfig}
                    className="button-ghost-on-dark button-ghost-sm"
                    style={{ backgroundColor: '#ffffff', color: '#000000', fontWeight: 700 }}
                    onClick={handleSaveProbeConfig}
                  >
                    {savingConfig ? '正在保存并热推送...' : '保存并即时生效 ➔'}
                  </button>
                </div>
              </div>
            </div>
          )}
          {/* Add Alert Rule / Webhook Destination Modal */}
          {showAddAlertModal && (
            <div className="modal-backdrop-dark">
              <div className="modal-box-dark" style={{ maxWidth: '540px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                  <span className="eyebrow-cap">+ 添加告警策略 / WEBHOOK 渠道</span>
                  <button
                    style={{ background: 'none', border: 'none', color: '#ffffff', fontSize: '18px', cursor: 'pointer' }}
                    onClick={() => setShowAddAlertModal(false)}
                  >
                    ✕
                  </button>
                </div>

                <form onSubmit={handleCreateAlert}>
                  <div style={{ marginBottom: '16px' }}>
                    <span className="eyebrow-cap" style={{ display: 'block', marginBottom: '8px' }}>规则类型 / RULE TYPE</span>
                    <select
                      value={newAlertType}
                      onChange={(e) => setNewAlertType(e.target.value as any)}
                      className="spacex-input"
                      style={{ background: '#000000', color: '#ffffff' }}
                    >
                      <option value="webhook">📢 Webhook 报警推送渠道 (Discord / Telegram / Slack / HTTP)</option>
                      <option value="offline">⚠️ 节点离线告警 (Offline 90s)</option>
                      <option value="cpu">🔥 CPU 使用率超限告警 (%)</option>
                      <option value="memory">🧠 内存使用率超限告警 (%)</option>
                      <option value="disk">💾 磁盘使用率超限告警 (%)</option>
                    </select>
                  </div>

                  <div style={{ marginBottom: '16px' }}>
                    <span className="eyebrow-cap" style={{ display: 'block', marginBottom: '8px' }}>作用节点 / TARGET NODE</span>
                    <select
                      value={newAlertNodeId}
                      onChange={(e) => setNewAlertNodeId(e.target.value)}
                      className="spacex-input"
                      style={{ background: '#000000', color: '#ffffff' }}
                    >
                      <option value="">🌐 全量节点 / GLOBAL (适用于所有机器)</option>
                      {adminNodes.map((n) => (
                        <option key={n.id} value={n.id}>
                          🖥️ {n.name.toUpperCase()} ({n.id.substring(0, 8)}...)
                        </option>
                      ))}
                    </select>
                  </div>

                  {newAlertType === 'webhook' ? (
                    <>
                      <div style={{ marginBottom: '16px' }}>
                        <span className="eyebrow-cap" style={{ display: 'block', marginBottom: '8px' }}>推送渠道平台 / NOTIFICATION PLATFORM</span>
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
                              TELEGRAM BOT TOKEN (来自 @BotFather)
                            </span>
                            <input
                              value={newAlertBotToken}
                              onChange={(e) => setNewAlertBotToken(e.target.value)}
                              placeholder="如 123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ"
                              className="spacex-input"
                              required
                            />
                          </div>

                          <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '12px', marginBottom: '16px' }}>
                            <div>
                              <span className="eyebrow-cap" style={{ display: 'block', marginBottom: '6px' }}>
                                CHAT ID (用户/群组/频道 ID)
                              </span>
                              <input
                                value={newAlertChatId}
                                onChange={(e) => setNewAlertChatId(e.target.value)}
                                placeholder="如 -100123456789 或 @my_channel"
                                className="spacex-input"
                                required
                              />
                            </div>
                            <div>
                              <span className="eyebrow-cap" style={{ display: 'block', marginBottom: '6px' }}>
                                API 域名 (可选，反代/加速)
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
                            BARK 服务器地址或设备 KEY
                          </span>
                          <input
                            value={newAlertWebhookUrl}
                            onChange={(e) => setNewAlertWebhookUrl(e.target.value)}
                            placeholder="如 https://api.day.app/your_device_key 或自建 Bark 地址"
                            className="spacex-input"
                            required
                          />
                        </div>
                      ) : newAlertChannel === 'serverchan' ? (
                        <div style={{ marginBottom: '16px' }}>
                          <span className="eyebrow-cap" style={{ display: 'block', marginBottom: '6px' }}>
                            SERVER酱 SENDKEY 或完整 WEBHOOK URL
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
                            placeholder="如 SCTxxxxxxxxxxxxxxxxxxxx 或 https://sctapi.ftqq.com/xxx.send"
                            className="spacex-input"
                            required
                          />
                        </div>
                      ) : newAlertChannel === 'pushdeer' ? (
                        <div style={{ marginBottom: '16px' }}>
                          <span className="eyebrow-cap" style={{ display: 'block', marginBottom: '6px' }}>
                            PUSHDEER PUSHKEY 或完整 WEBHOOK URL
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
                            placeholder="如 PDUxxxxxxxxxxxxxxxxxxxx 或完整 URL"
                            className="spacex-input"
                            required
                          />
                        </div>
                      ) : newAlertChannel === 'custom' ? (
                        <>
                          <div style={{ display: 'grid', gridTemplateColumns: '100px 1fr', gap: '12px', marginBottom: '12px' }}>
                            <div>
                              <span className="eyebrow-cap" style={{ display: 'block', marginBottom: '6px' }}>请求方式</span>
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
                                请求 URL (支持模板变量，如 &#123;&#123;node_name&#125;&#125;)
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
                                  BODY 数据格式 (CONTENT-TYPE)
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
                                  自定义 POST 请求体模板 (可选，留空使用标准 JSON)
                                </span>
                                <textarea
                                  value={newAlertBodyTemplate}
                                  onChange={(e) => setNewAlertBodyTemplate(e.target.value)}
                                  placeholder='如 {"title":"{{title}}", "msg":"{{message}}", "node":"{{node_name}}"}'
                                  className="spacex-input"
                                  style={{ height: '70px', resize: 'vertical', fontSize: '11px', fontFamily: 'monospace' }}
                                />
                              </div>
                            </>
                          )}

                          <div style={{ marginBottom: '12px' }}>
                            <span className="eyebrow-cap" style={{ display: 'block', marginBottom: '6px' }}>
                              自定义请求头 / HEADERS (JSON 格式，可选)
                            </span>
                            <input
                              value={newAlertHeaders}
                              onChange={(e) => setNewAlertHeaders(e.target.value)}
                              placeholder='{"Authorization": "Bearer your_token"}'
                              className="spacex-input"
                            />
                          </div>

                          <div style={{ padding: '8px 12px', background: 'rgba(255, 255, 255, 0.03)', border: '1px solid var(--colors-hairline-on-dark)', borderRadius: '4px', marginBottom: '16px', fontSize: '10px', color: 'var(--colors-muted)' }}>
                            💡 可用模板变量：<code>&#123;&#123;node_name&#125;&#125;</code>, <code>&#123;&#123;event&#125;&#125;</code>, <code>&#123;&#123;title&#125;&#125;</code>, <code>&#123;&#123;message&#125;&#125;</code>, <code>&#123;&#123;emoji&#125;&#125;</code>, <code>&#123;&#123;time&#125;&#125;</code>
                          </div>
                        </>
                      ) : (
                        <div style={{ marginBottom: '16px' }}>
                          <span className="eyebrow-cap" style={{ display: 'block', marginBottom: '6px' }}>
                            {newAlertChannel.toUpperCase()} WEBHOOK URL
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
                        🔒 凭据保护：所有 Bot Token、Key 与 Webhook 地址均使用 AES-GCM 256 位高强度加密落盘，数据库零明文残留。
                      </div>
                    </>
                  ) : newAlertType === 'offline' ? (
                    <div style={{ padding: '12px 16px', background: 'rgba(255, 255, 255, 0.02)', border: '1px solid var(--colors-hairline-on-dark)', borderRadius: '4px', marginBottom: '20px', fontSize: '12px', color: 'var(--colors-muted)' }}>
                      ℹ️ 离线判定规则：当被控端 Agent 超过 90 秒无有效心跳上报时自动触发 Firing 告警，心跳恢复后自动触发 Resolved 恢复通知。
                    </div>
                  ) : (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '20px' }}>
                      <div>
                        <span className="eyebrow-cap" style={{ display: 'block', marginBottom: '8px' }}>触发阈值 / THRESHOLD (%)</span>
                        <input
                          type="number"
                          value={newAlertThreshold}
                          onChange={(e) => setNewAlertThreshold(parseInt(e.target.value) || 80)}
                          min={1}
                          max={100}
                          className="spacex-input"
                          required
                        />
                      </div>
                      <div>
                        <span className="eyebrow-cap" style={{ display: 'block', marginBottom: '8px' }}>持续时间 / DURATION (秒)</span>
                        <input
                          type="number"
                          value={newAlertDurationSec}
                          onChange={(e) => setNewAlertDurationSec(parseInt(e.target.value) || 60)}
                          min={10}
                          max={3600}
                          className="spacex-input"
                          required
                        />
                      </div>
                    </div>
                  )}

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
                    {newAlertType === 'webhook' ? (
                      <button
                        type="button"
                        disabled={testingAlert}
                        className="button-ghost-on-dark button-ghost-sm"
                        style={{ borderColor: '#38bdf8', color: '#38bdf8' }}
                        onClick={handleTestAlert}
                      >
                        {testingAlert ? '正在测试发送...' : '📢 发送测试通知'}
                      </button>
                    ) : <div></div>}

                    <div style={{ display: 'flex', gap: '12px' }}>
                      <button
                        type="button"
                        className="button-ghost-on-dark button-ghost-sm"
                        onClick={() => setShowAddAlertModal(false)}
                      >
                        {t('cancel_btn')}
                      </button>
                      <button
                        type="submit"
                        disabled={creatingAlert}
                        className="button-ghost-on-dark button-ghost-sm"
                        style={{ backgroundColor: '#ffffff', color: '#000000', fontWeight: 700 }}
                      >
                        {creatingAlert ? '正在保存并加密...' : '保存策略 ➔'}
                      </button>
                    </div>
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
