import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'

interface SummaryCellProps {
  text?: string | null
}

export function SummaryCell({ text }: SummaryCellProps) {
  if (!text) {
    return <span className="font-sans text-[12.5px] italic text-text-faint">未调研</span>
  }
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <div
            className="schools-summary-cell group cursor-help font-serif text-[14px] leading-[1.55] text-text"
            style={{
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }}
          >
            <span className="rounded-[2px] underline decoration-text-faint/0 decoration-dashed underline-offset-[3px] transition-[text-decoration-color] duration-150 group-hover:decoration-text-muted/70">
              {text}
            </span>
          </div>
        </TooltipTrigger>
        <TooltipContent
          side="left"
          align="start"
          sideOffset={12}
          collisionPadding={16}
          className="z-50 max-w-[420px] rounded-md border border-border bg-bg px-3.5 py-3 font-serif text-[13.5px] leading-[1.65] text-text shadow-[0_8px_24px_rgba(0,0,0,0.08)]"
        >
          {text}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
