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

  const [oneTimeTokenModal, setOneTimeTokenModal] = useState<{ nodeId: string; rawToken: string } | null>(null);

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
      const res = await createAdminNode({
        name: newNodeName,
        traffic_reset_day: newNodeResetDay,
      });
      setShowAddModal(false);
      setNewNodeName('');
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
      });
    } catch (err: any) {
      alert(err.message);
    }
  }

  async function handleDeleteNode(nodeId: string) {
    if (!confirm('DECOMMISSION NODE? All historical telemetry will be permanently wiped.')) {
      return;
    }
    try {
      await deleteAdminNode(nodeId);
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

                  <div style={{ marginBottom: '24px' }}>
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

          {/* Token Modal */}
          {oneTimeTokenModal && (
            <div className="modal-backdrop-dark">
              <div className="modal-box-dark">
                <span className="eyebrow-cap" style={{ color: 'var(--colors-status-live)' }}>
                  {t('token_modal_title')}
                </span>
                <h3 className="display-lg" style={{ fontSize: '20px', margin: '8px 0' }}>
                  {t('token_modal_title')}
                </h3>
                <p className="caption" style={{ color: 'var(--colors-status-alert)' }}>
                  {t('token_notice')}
                </p>

                <div className="token-view-chassis">
                  {oneTimeTokenModal.rawToken}
                </div>

                <span className="eyebrow-cap" style={{ fontSize: '10px' }}>
                  NODE UUID: {oneTimeTokenModal.nodeId}
                </span>

                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '24px' }}>
                  <button className="button-ghost-on-dark" onClick={() => setOneTimeTokenModal(null)}>
                    {t('save_node_btn')}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
