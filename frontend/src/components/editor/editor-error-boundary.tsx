import { Component, type ReactNode } from "react"
import { AlertTriangle, RotateCcw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { tx } from "@/lib/i18n"

interface Props {
  children: ReactNode
  label?: string
}

interface State {
  hasError: boolean
  error: Error | null
}

export class EditorErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  handleReload = () => {
    this.setState({ hasError: false, error: null })
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex h-full items-center justify-center p-8">
          <div className="text-center max-w-sm">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-destructive/10">
              <AlertTriangle className="h-6 w-6 text-destructive" />
            </div>
            <h2 className="text-lg font-semibold text-foreground">
              {tx("editor.boundaryCrashed", { label: this.props.label ?? tx("editor.boundarySomething") })}
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              {this.state.error?.message ?? tx("editor.boundaryUnexpected")}
            </p>
            <Button variant="outline" className="mt-4" onClick={this.handleReload}>
              <RotateCcw className="size-4" />
              {tx("editor.boundaryReload")}
            </Button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
