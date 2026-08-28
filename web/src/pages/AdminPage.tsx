import React, { useState } from 'react';
import {
  adminLogin,
  adminLogout,
  createAdminNode,
  deleteAdminNode,
  rotateAdminNodeToken,
} from '../api/client';
import { useAdminSessionQuery, useAdminNodesQuery } from '../queries/nodes';
import { useTranslation } from '../i18n/I18nContext';

export const AdminPage: React.FC = () => {
  const { data: sessionData, refetch: refetchSession } = useAdminSessionQuery();
  const authenticated = sessionData?.authenticated || false;
  const { t } = useTranslation();

  const { data: nodesData, refetch: refetchNodes } = useAdminNodesQuery(authenticated);

  const [adminKey, setAdminKey] = useState('');
  const [loggingIn, setLoggingIn] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);

  const [showAddModal, setShowAddModal] = useState(false);
  const [newNodeName, setNewNodeName] = useState('');
  const [newNodeResetDay, setNewNodeResetDay] = useState(1);
  const [newNodeQuotaGb, setNewNodeQuotaGb] = useState('');
  const [newNodeExpiresAt, setNewNodeExpiresAt] = useState('');
  const [newNodeNote, setNewNodeNote] = useState('');

  const [oneTimeTokenModal, setOneTimeTokenModal] = useState<{ nodeId: string; rawToken: string; warning?: string } | null>(null);
  const [adminBannerWarning, setAdminBannerWarning] = useState<string | null>(null);
  const [cmdTab, setCmdTab] = useState<'binary' | 'docker' | 'systemd' | 'raw'>('binary');
  const [copyFeedback, setCopyFeedback] = useState(false);

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

  async function handleCreateNode(e: React.FormEvent) {
    e.preventDefault();
    try {
      const quotaBytes = newNodeQuotaGb ? parseFloat(newNodeQuotaGb) * 1024 * 1024 * 1024 : null;
      const expiresAtMs = newNodeExpiresAt ? new Date(newNodeExpiresAt).getTime() : null;

      const res = await createAdminNode({
        name: newNodeName,
        traffic_reset_day: newNodeResetDay,
        traffic_quota_bytes: quotaBytes,
        expires_at_ms: expiresAtMs,
        note: newNodeNote || null,
      });
      setShowAddModal(false);
      setNewNodeName('');
      setNewNodeQuotaGb('');
      setNewNodeExpiresAt('');
      setNewNodeNote('');
      setOneTimeTokenModal({
        nodeId: res.node.id,
        rawToken: res.rawToken,
      });
      refetchNodes();
    } catch (err: any) {
      alert(err.message);
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
      {!authenticated ? (
        <div className="admin-card-chassis">
          <span className="eyebrow-cap">{t('admin_title')}</span>
          <h2 className="display-lg" style={{ fontSize: '24px', margin: '8px 0 16px' }}>
            {t('nav_console')}
          </h2>
          <p className="caption" style={{ marginBottom: '24px' }}>
            {t('admin_login_sub')}
          </p>

          <form onSubmit={handleLogin}>
            <div style={{ marginBottom: '20px' }}>
              <span className="eyebrow-cap" style={{ display: 'block', marginBottom: '8px' }}>{t('admin_key_label')}</span>
              <input
                value={adminKey}
                onChange={(e) => setAdminKey(e.target.value)}
                type="password"
                placeholder="ADMIN_KEY..."
                className="spacex-input"
                required
              />
            </div>

            {loginError && (
              <p className="caption" style={{ color: 'var(--colors-status-alert)', marginBottom: '16px' }}>
                {loginError.toUpperCase()}
              </p>
            )}

            <button type="submit" className="button-ghost-on-dark" style={{ width: '100%' }} disabled={loggingIn}>
              {loggingIn ? '...' : t('admin_login_btn')}
            </button>
          </form>
        </div>
      ) : (
        <div>
          {/* Admin Header */}
          <div className="section-title-bar">
            <div>
              <span className="eyebrow-cap">{t('admin_nodes_title')}</span>
              <h2 className="display-lg" style={{ fontSize: '24px', marginTop: '4px' }}>
                {t('fleet_nodes_title')}
              </h2>
            </div>
            <div style={{ display: 'flex', gap: '12px' }}>
              <button className="button-ghost-on-dark button-ghost-sm" onClick={() => setShowAddModal(true)}>
                {t('create_node_btn')}
              </button>
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

          {/* Node Table */}
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
                      <strong>{n.name.toUpperCase()}</strong>
                    </td>
                    <td>
                      <span style={{ fontFamily: 'monospace', fontSize: '11px', color: 'var(--colors-on-primary-mute)' }}>
                        {n.id}
                      </span>
                    </td>
                    <td>{t('day_prefix')}{n.traffic_reset_day}{t('day_suffix')}</td>
                    <td>{new Date(n.created_at_ms).toISOString().split('T')[0]}</td>
                    <td>
                      <div style={{ display: 'flex', gap: '8px' }}>
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
                  <span className="eyebrow-cap" style={{ color: 'var(--colors-status-live)' }}>
                    {t('token_modal_title')}
                  </span>
                  <h3 className="display-lg" style={{ fontSize: '20px', margin: '8px 0' }}>
                    {t('token_modal_title')}
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
        </div>
      )}
    </div>
  );
};
