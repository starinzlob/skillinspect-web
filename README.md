# SkillInspect Web

粘贴公开的 GitHub Agent Skill 链接，在安装前查看静态能力与安全报告。<br>
Paste a public GitHub Agent Skill URL and inspect it before installation.

[中文](#中文) · [English](#english)

## 中文

SkillInspect Web 会生成一份静态的安装前报告，覆盖运行时命令、凭据名称、网络主机、文件写入、外部副作用，以及带来源证据的安全问题。

浏览器会直接读取 GitHub 上的公开文件。网站不会执行 Skill 代码、保存仓库内容，也不要求用户登录。

### 开发

```bash
npm install
npm test
npm run dev
```

完整的本地 CLI 仍可通过 [`skillinspect`](https://github.com/starinzlob/skillinspect) 使用。

本项目采用 MIT 许可。

---

## English

SkillInspect Web produces a static pre-install report covering runtime commands, credential names, network hosts, file writes, external side effects, and traceable safety findings.

The browser reads public GitHub files directly. The site does not execute Skill code, store repository contents, or require an account.

### Development

```bash
npm install
npm test
npm run dev
```

The full local CLI remains available as [`skillinspect`](https://github.com/starinzlob/skillinspect).

MIT licensed.
