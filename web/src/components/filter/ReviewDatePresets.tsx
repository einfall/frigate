import { useTranslation } from "react-i18next";
import useSWR from "swr";
import type { FrigateConfig } from "@/types/frigateConfig";
import type { ReviewDatePreset, ReviewFilter } from "@/types/review";
import { getReviewPresetRange } from "@/utils/reviewDatePreset";
import { Button } from "../ui/button";

const PRESETS = ["currentWeek", "lastWeek", "currentMonth", "lastMonth"] as const satisfies readonly ReviewDatePreset[];

type ReviewDatePresetsProps = {
  filter?: ReviewFilter;
  onUpdateFilter: (filter: ReviewFilter) => void;
  onSelect?: () => void;
};

export default function ReviewDatePresets({ filter, onUpdateFilter, onSelect }: ReviewDatePresetsProps) {
  const { t } = useTranslation("views/events");
  const { data: config } = useSWR<FrigateConfig>("config");

  const select = (datePreset?: ReviewDatePreset) => {
    onUpdateFilter({
      ...filter,
      ...getReviewPresetRange(datePreset, new Date(), config?.ui.timezone || "Europe/Berlin"),
      datePreset,
    });
    onSelect?.();
  };

  return (
    <div className="grid grid-cols-1 gap-1 p-2" role="group" aria-label={t("calendarFilter.period")}>
      <Button size="sm" variant={filter?.after == undefined ? "select" : "default"}
        className="justify-start" aria-pressed={filter?.after == undefined} onClick={() => select()}>
        {t("calendarFilter.last24Hours")}
      </Button>
      {PRESETS.map((preset) => (
        <Button key={preset} size="sm" className="justify-start"
          variant={filter?.datePreset === preset ? "select" : "default"}
          aria-pressed={filter?.datePreset === preset} onClick={() => select(preset)}>
          {t(`calendarFilter.${preset}`)}
        </Button>
      ))}
    </div>
  );
}
