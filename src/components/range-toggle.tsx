import { Button } from "@/components/ui/button";
import { RANGE_LABELS, type RangeOption } from "@/lib/rate-view";

const RANGE_OPTIONS: RangeOption[] = [
  "7d",
  "30d",
  "60d",
  "90d",
  "180d",
  "365d",
];

export function RangeToggle({
  value,
  onChange,
}: {
  value: RangeOption;
  onChange: (value: RangeOption) => void;
}) {
  return (
    <div
      className="flex flex-wrap items-center justify-center gap-1"
      role="group"
      aria-label="时间范围"
    >
      {RANGE_OPTIONS.map((option) => (
        <Button
          className="text-base"
          key={option}
          type="button"
          size="lg"
          variant={value === option ? "default" : "outline"}
          aria-pressed={value === option}
          onClick={() => onChange(option)}
        >
          {RANGE_LABELS[option]}
        </Button>
      ))}
    </div>
  );
}
