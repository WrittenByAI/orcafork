import { translate } from '@/i18n/i18n'

/**
 * Common languages shown in the selector. The user can also type a language
 * name directly in the markdown fence (```rust) and it will be preserved —
 * this list is just for quick picking in the UI.
 */
export const RICH_MARKDOWN_CODE_BLOCK_LANGUAGES = [
  {
    value: '',
    get label() {
      return translate('auto.components.editor.RichMarkdownCodeBlock.13822cdfda', 'Plain text')
    }
  },
  {
    value: 'bash',
    get label() {
      return translate('auto.components.editor.RichMarkdownCodeBlock.4227cf50fe', 'Bash')
    }
  },
  { value: 'c', label: 'C' },
  {
    value: 'cpp',
    get label() {
      return translate('auto.components.editor.RichMarkdownCodeBlock.4daed43ae3', 'C++')
    }
  },
  {
    value: 'css',
    get label() {
      return translate('auto.components.editor.RichMarkdownCodeBlock.026653f21f', 'CSS')
    }
  },
  {
    value: 'diff',
    get label() {
      return translate('auto.components.editor.RichMarkdownCodeBlock.bf6ee5caaa', 'Diff')
    }
  },
  {
    value: 'go',
    get label() {
      return translate('auto.components.editor.RichMarkdownCodeBlock.edfcc64182', 'Go')
    }
  },
  {
    value: 'graphql',
    get label() {
      return translate('auto.components.editor.RichMarkdownCodeBlock.706fd85738', 'GraphQL')
    }
  },
  {
    value: 'html',
    get label() {
      return translate('auto.components.editor.RichMarkdownCodeBlock.8c4a3fa02d', 'HTML')
    }
  },
  {
    value: 'java',
    get label() {
      return translate('auto.components.editor.RichMarkdownCodeBlock.36536ad539', 'Java')
    }
  },
  {
    value: 'javascript',
    get label() {
      return translate('auto.components.editor.RichMarkdownCodeBlock.a209c57063', 'JavaScript')
    }
  },
  {
    value: 'json',
    get label() {
      return translate('auto.components.editor.RichMarkdownCodeBlock.78eba32de4', 'JSON')
    }
  },
  {
    value: 'kotlin',
    get label() {
      return translate('auto.components.editor.RichMarkdownCodeBlock.bcb236e2d8', 'Kotlin')
    }
  },
  {
    value: 'markdown',
    get label() {
      return translate('auto.components.editor.RichMarkdownCodeBlock.983b9576b4', 'Markdown')
    }
  },
  {
    value: 'mermaid',
    get label() {
      return translate('auto.components.editor.RichMarkdownCodeBlock.89d6cc14fb', 'Mermaid')
    }
  },
  {
    value: 'python',
    get label() {
      return translate('auto.components.editor.RichMarkdownCodeBlock.2391f9cda9', 'Python')
    }
  },
  {
    value: 'ruby',
    get label() {
      return translate('auto.components.editor.RichMarkdownCodeBlock.96182a2f64', 'Ruby')
    }
  },
  {
    value: 'rust',
    get label() {
      return translate('auto.components.editor.RichMarkdownCodeBlock.e72e6b03f4', 'Rust')
    }
  },
  {
    value: 'scss',
    get label() {
      return translate('auto.components.editor.RichMarkdownCodeBlock.5af8251002', 'SCSS')
    }
  },
  {
    value: 'shell',
    get label() {
      return translate('auto.components.editor.RichMarkdownCodeBlock.d01f55be57', 'Shell')
    }
  },
  {
    value: 'sql',
    get label() {
      return translate('auto.components.editor.RichMarkdownCodeBlock.3009f722b9', 'SQL')
    }
  },
  {
    value: 'swift',
    get label() {
      return translate('auto.components.editor.RichMarkdownCodeBlock.9e384d48dc', 'Swift')
    }
  },
  {
    value: 'typescript',
    get label() {
      return translate('auto.components.editor.RichMarkdownCodeBlock.88d777bc07', 'TypeScript')
    }
  },
  {
    value: 'xml',
    get label() {
      return translate('auto.components.editor.RichMarkdownCodeBlock.5ef5605cb7', 'XML')
    }
  },
  {
    value: 'yaml',
    get label() {
      return translate('auto.components.editor.RichMarkdownCodeBlock.74eab1d9b2', 'YAML')
    }
  }
]
