import { Component, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  resetKey?: unknown;
}

interface State {
  error: Error | null;
}

// Contains a render error to the offending panel instead of letting it unmount
// the whole React tree (which showed up as a full black screen). Each panel's
// content is wrapped individually so one bad payload can't take down the app.
export class PanelErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error('Panel content failed to render:', error);
  }

  componentDidUpdate(prev: Props) {
    // A re-open of the same panel (new payload object) retries rendering;
    // unrelated re-renders (drag, resize, focus, lock) keep the error shown.
    if (this.state.error && prev.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  render() {
    if (this.state.error) {
      return (
        <div className="space-y-1 text-[13px]">
          <p className="font-medium text-accent-danger">Couldn’t render this panel.</p>
          <p className="text-white/40">{this.state.error.message}</p>
        </div>
      );
    }
    return this.props.children;
  }
}
