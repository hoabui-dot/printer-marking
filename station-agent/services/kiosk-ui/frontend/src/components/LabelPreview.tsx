import { QRCodeSVG } from 'qrcode.react'

interface LabelElement {
  id?: string
  type: string
  x: number
  y: number
  fontSize?: number
  font?: string
  text?: string
  binding?: string
  defaultValue?: string
  width?: number
  height?: number
  strokeWidth?: number
  magnification?: number
  payloadTemplate?: string
  symbology?: string
}

interface LabelTemplate {
  width: number // in mm
  height: number // in mm
  dpi: number
  elements: LabelElement[]
}

interface LabelPreviewProps {
  template: LabelTemplate | string | null | undefined
  data: Record<string, string>
  width?: number // Display width in pixels
  className?: string
}

export function LabelPreview({
  template,
  data,
  width = 400,
  className = '',
}: LabelPreviewProps) {
  // Parse template if passed as string or contains templateJson string
  let parsedTemplate: LabelTemplate | null = null
  let jsonStr: string | null = null

  if (typeof template === 'string') {
    jsonStr = template
  } else if (template && typeof template === 'object') {
    const wrapper = template as any
    const rawJson = wrapper.templateJson || wrapper.TemplateJson
    if (typeof rawJson === 'string') {
      jsonStr = rawJson
    } else if (Array.isArray(wrapper.elements)) {
      parsedTemplate = wrapper
    }
  }

  if (jsonStr) {
    try {
      parsedTemplate = JSON.parse(jsonStr)
    } catch {
      parsedTemplate = null
    }
  }

  if (!parsedTemplate) {
    return (
      <div
        className={`flex items-center justify-center border border-dashed border-border rounded-lg bg-surface-2 text-muted-fg text-xs italic ${className}`}
        style={{ width, height: (width * 3) / 5 }}
      >
        Lỗi phân tích Template
      </div>
    )
  }

  // Dots dimensions from template
  const dpi = parsedTemplate.dpi || 203
  const mmWidth = parsedTemplate.width || 50
  const mmHeight = parsedTemplate.height || 30

  const dotsWidth = Math.round((mmWidth / 25.4) * dpi)

  const height = (width * mmHeight) / mmWidth
  const scale = width / dotsWidth

  // Helper to resolve binding values
  const resolveBinding = (el: LabelElement): string => {
    if (el.binding && el.binding.trim() !== '') {
      const key = el.binding.trim()
      if (data && data[key] !== undefined && data[key] !== null) {
        return data[key]
      }
      return el.defaultValue ?? el.text ?? `{${key}}`
    }
    return el.text ?? el.defaultValue ?? ''
  }

  // Helper to resolve QR payload templates
  const resolveQrPayload = (el: LabelElement): string => {
    if (el.payloadTemplate && el.payloadTemplate.trim() !== '') {
      let resolved = el.payloadTemplate
      // Match all occurrences of {variable_name}
      resolved = resolved.replace(/{([^{}]+)}/g, (match, key) => {
        const trimmedKey = key.trim()
        if (data && data[trimmedKey] !== undefined && data[trimmedKey] !== null) {
          return data[trimmedKey]
        }
        return match // Return original placeholder if not found
      })
      return resolved
    }
    return resolveBinding(el)
  }

  return (
    <div
      className={`relative select-none overflow-hidden bg-white text-black border border-zinc-200 shadow-sm ${className}`}
      style={{
        width: `${width}px`,
        height: `${height}px`,
        minWidth: `${width}px`,
        minHeight: `${height}px`,
      }}
    >
      {parsedTemplate.elements.map((el, idx) => {
        const elType = (el.type || '').toLowerCase()
        const x = el.x * scale
        const y = el.y * scale

        switch (elType) {
          case 'text': {
            const fontSize = (el.fontSize ?? 12) * scale * 1.3
            const textVal = resolveBinding(el)
            return (
              <div
                key={idx}
                className="absolute font-sans font-bold leading-none whitespace-nowrap text-left"
                style={{
                  left: `${x}px`,
                  top: `${y}px`,
                  fontSize: `${fontSize}px`,
                  fontFamily: 'monospace, Arial, sans-serif',
                }}
              >
                {textVal}
              </div>
            )
          }

          case 'rect': {
            const elWidth = (el.width ?? 100) * scale
            const elHeight = (el.height ?? 50) * scale
            const strokeWidth = (el.strokeWidth ?? 2) * scale
            return (
              <div
                key={idx}
                className="absolute border border-black"
                style={{
                  left: `${x}px`,
                  top: `${y}px`,
                  width: `${elWidth}px`,
                  height: `${elHeight}px`,
                  borderWidth: `${Math.max(strokeWidth, 1)}px`,
                  boxSizing: 'border-box',
                }}
              />
            )
          }

          case 'circle': {
            const diameter = (el.width ?? 60) * scale
            const strokeWidth = (el.strokeWidth ?? 2) * scale
            return (
              <div
                key={idx}
                className="absolute border border-black rounded-full"
                style={{
                  left: `${x}px`,
                  top: `${y}px`,
                  width: `${diameter}px`,
                  height: `${diameter}px`,
                  borderWidth: `${Math.max(strokeWidth, 1)}px`,
                  boxSizing: 'border-box',
                }}
              />
            )
          }

          case 'line': {
            const elWidth = (el.width ?? 100) * scale
            const elHeight = (el.height ?? 2) * scale
            const thickness = Math.max(elHeight, 1)
            return (
              <div
                key={idx}
                className="absolute bg-black"
                style={{
                  left: `${x}px`,
                  top: `${y}px`,
                  width: `${elWidth}px`,
                  height: `${thickness}px`,
                }}
              />
            )
          }

          case 'qr': {
            const qrPayload = resolveQrPayload(el)
            // Visual size estimation based on magnification:
            // Mag 4 => ~100 dots wide. Mag 3 => ~75 dots wide.
            const mag = el.magnification ?? 4
            const qrSize = mag * 25 * scale // estimate 25 modules
            return (
              <div
                key={idx}
                className="absolute flex items-center justify-center p-0.5 bg-white border border-zinc-100"
                style={{
                  left: `${x}px`,
                  top: `${y}px`,
                  width: `${qrSize}px`,
                  height: `${qrSize}px`,
                }}
              >
                <QRCodeSVG
                  value={qrPayload}
                  size={qrSize - 4}
                  level="M"
                  includeMargin={false}
                />
              </div>
            )
          }

          case 'barcode': {
            const value = resolveBinding(el)
            return (
              <div
                key={idx}
                className="absolute flex flex-col items-center justify-center border border-zinc-300 bg-zinc-50 overflow-hidden"
                style={{
                  left: `${x}px`,
                  top: `${y}px`,
                  width: `${(el.width ?? 120) * scale}px`,
                  height: `${(el.height ?? 50) * scale}px`,
                }}
              >
                <div className="text-[7px] text-zinc-400 font-mono tracking-tighter leading-none">
                  ▐█▐█▐▌█▌
                </div>
                <div className="text-[8px] font-mono text-black select-none truncate max-w-full px-1 scale-75 mt-0.5">
                  {value}
                </div>
              </div>
            )
          }

          default:
            return null
        }
      })}
    </div>
  )
}

export default LabelPreview
