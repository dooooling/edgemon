# EdgeMon 安全架构与最佳实践 (Security Architecture & Best Practices)

EdgeMon 遵循 **零远程执行（No Remote Execution）** 与 **最小特权原则（Principle of Least Privilege）**，旨在构建一个低攻击面、防篡改、抗重放的分布式服务器监控系统。

---

## 1. 核心安全模型与不变量

1. **绝对无远程执行通道（No RCE / No Shell）**：
   - Agent 坚决不包含 WebSSH、远程终端、任意脚本执行、文件编辑、进程启停等功能。
   - 所有下发的配置仅限指标采样间隔（`sample_interval_sec`）与有限的连通性探测目标（`probes`）。
2. **零外部命令依赖（Zero Subprocess Spawning）**：
   - Agent 严禁调用 `systemd-detect-virt`、`free`、`df` 等外部命令，全部通过读取 Linux `/proc`、`/sys` 伪文件系统或原生系统调用采集，根绝命令注入风险。
3. **节点凭据单向哈希（One-Way Token Hashing）**：
   - D1 数据库仅存储 `SHA-256(node_token)`，明文 Token 仅在生成或轮转时展示一次，服务端无法还原明文。

---

## 2. 探测与 Webhook 的 SSRF 双层防御

### 2.1 Agent 端网络探测防护
- **私网阻断**：Agent 默认禁止探测回环地址（`127.0.0.1`, `::1`）、私网 IP（`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`）及链路本地地址（`169.254.0.0/16`）。
- **DNS 解析后校验**：当探测目标为域名时，Agent 必须在 **DNS 解析之后** 校验其实际解析到的 IP 地址，彻底防止 DNS Rebinding 攻击。
- **本地控制权**：`allow_private_probes` 仅允许在 Agent 本地 CLI 参数中显式开启，云端 Worker 下发无效。

### 2.2 Worker 端 Webhook SSRF 防御
- **协议约束**：仅允许 `https://`（开发测试除外）。
- **IP 黑名单**：自动拦截 Localhost、RFC1918 私网、Carrier-Grade NAT（`100.64.0.0/10`）以及云厂商元数据地址（`169.254.169.254`）。

---

## 3. `DATA_ENCRYPTION_KEY` 生产生命周期与轮转

### 3.1 密钥作用与算法
- **用途**：用于对存储在 `secret_settings` 中的敏感配置（如 Webhook 签名密钥、告警 Token 等）进行应用层加密。
- **算法**：AES-GCM 256 位加密，每次加密生成 96 位密码学安全随机 Nonce（IV），密文附加 128 位认证标签（Auth Tag）。

### 3.2 密钥丢失影响与防范
- **影响**：如果 `DATA_ENCRYPTION_KEY` 在 Worker 环境变量中丢失或被覆盖，已加密的敏感配置将无法解密。
- **防范**：部署前必须将 `DATA_ENCRYPTION_KEY` 妥善保存在安全的密码管理器中（如 1Password、Bitwarden 或 HashiCorp Vault）。

### 3.3 密钥轮转方案（Key Rotation Procedure）
当需要轮转 `DATA_ENCRYPTION_KEY` 时：
1. 先在管理后台将已配置的敏感 Webhook 重新填写或通过控制台导出。
2. 设置新密钥：`npx wrangler secret put DATA_ENCRYPTION_KEY`。
3. 登录后台重新保存 Webhook 配置，系统将以新密钥加密持久化。

---

## 4. 控制台防爆破与双层防护推荐

### 4.1 内置防爆破与审计
- **速率限制与封禁**：单个 IP 连续登录失败 5 次，系统自动锁定 5 分钟（返回 HTTP 429）。
- **防时序攻击**：密码匹配采用 `timingSafeEqual` 常量时间对比。
- **审计日志**：所有登录成功与失败事件记录在 D1 `events` 审计表中。

### 4.2 生产双层防护（Cloudflare Access + Admin Key）
对于生产环境，强烈推荐在 Cloudflare Zero Trust 仪表盘为 `/admin*`、`/api/auth/*` 与 `/api/admin/*` 路径开启 **Cloudflare Access (Zero Trust)** 保护策略：
1. 访问后台或调用管理 API 时首先通过企业 SSO / GitHub OAuth / 邮箱验证码完成边缘第一层身份核验。
2. 进入页面后输入 EdgeMon `ADMIN_KEY` 并获取加密 HttpOnly Session Cookie 完成第二层鉴权。
3. 即使 `ADMIN_KEY` 意外泄漏，未通过 Cloudflare Access 边缘认证的外部请求在 Cloudflare Edge 网络层即被 403 阻断，彻底杜绝公网爆破风险。
