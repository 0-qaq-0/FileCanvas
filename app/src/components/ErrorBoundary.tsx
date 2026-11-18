import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';

// A programming error while drawing would otherwise leave an empty window. Each canvas change is
// saved as it happens, so reloading loses nothing.
export class ErrorBoundary extends Component<{ children: ReactNode }, { message: string | null }> {
  state = { message: null as string | null };
  static getDerivedStateFromError(error: unknown) {
    return { message: error instanceof Error ? error.message : String(error) };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(error, info.componentStack);
  }
  render() {
    if (this.state.message === null) return this.props.children;
    return (
      <main className="crash-screen" role="alert">
        <h1>界面遇到了问题</h1>
        <p>整理计划已自动保存，本地文件没有受到影响。重新加载后可以继续。</p>
        <code>{this.state.message}</code>
        <button className="button primary" onClick={() => window.location.reload()}>
          重新加载
        </button>
      </main>
    );
  }
}
