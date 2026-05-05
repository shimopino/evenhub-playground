# evenhub-playground

[`even-realities/evenhub-templates`](https://github.com/even-realities/evenhub-templates/tree/main) を参考にしながら、Even Hub / G2 向けアプリのさまざまな挙動や実装パターンを検証するための実験用リポジトリです。

このリポジトリでは、以下のような検証を目的としています。

- UI 表示やレイアウトの確認
- 入力イベントや操作フローの確認
- 音声・画像などの機能検証
- シミュレータや実機での動作確認

本番利用を前提としたアプリではなく、試作・比較・検証を素早く行うことを目的としています。

## 前提

このリポジトリでは、[`even-realities/everything-evenhub`](https://github.com/even-realities/everything-evenhub) で提供される Claude Code プラグイン（agent skills）がグローバルにインストールされていることを前提としています。各スキル（`/quickstart`, `/glasses-ui`, `/handle-input` など）が利用可能な状態で使用してください。

### インストール方法

```bash
# Claude Code 上で実行
/plugin marketplace add even-realities/everything-evenhub
/plugin install everything-evenhub@everything-evenhub
```

参考:

- [evenhub-templates](https://github.com/even-realities/evenhub-templates/blob/main/README.md)
