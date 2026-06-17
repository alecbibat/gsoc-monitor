import { Component, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
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
