| Target | Download | Docker image |
| --- | --- | --- |
| macOS Apple Silicon | [stable-macos-arm64-LCAgent.dmg]({{MACOS_ARM64_URL}}) | - |
| macOS Intel | [stable-macos-x64-LCAgent.dmg]({{MACOS_X64_URL}}) | - |
| Windows x64 | [stable-win-x64-LCAgent-Setup.zip]({{WIN_X64_URL}}) | - |
| Linux x64 | [stable-linux-x64-LCAgent-Setup.tar.gz]({{LINUX_X64_URL}}) | - |
| Docker version | - | `{{DOCKER_IMAGE_VERSION}}` |
| Docker latest | - | `ghcr.io/leuki/open-lc:latest` |

macOS 如果遇到 LC Agent 无法打开，可以安装后执行：

```sh
sudo xattr -r -d com.apple.quarantine /Applications/LC\ Agent.app
```
