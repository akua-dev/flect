import type { ModelSummary } from "../../shared/contracts";
import { ChevronIcon } from "./icons";

export interface ModelMenuProps {
  readonly models: ReadonlyArray<ModelSummary>;
  readonly selectedModel: ModelSummary | undefined;
  readonly disabled: boolean;
  readonly onSelect: (model: ModelSummary | undefined) => void;
}

const modelValue = (model: ModelSummary) => `${model.provider}:${model.id}`;

export function ModelMenu({
  models,
  selectedModel,
  disabled,
  onSelect,
}: ModelMenuProps) {
  const selectedValue = selectedModel ? modelValue(selectedModel) : "auto";

  return (
    <label className="model-menu">
      <span className="sr-only">Model</span>
      <select
        aria-label="Model"
        disabled={disabled}
        name="model"
        onChange={(event) => {
          const next = models.find(
            (model) => modelValue(model) === event.target.value,
          );
          onSelect(next);
        }}
        value={selectedValue}
      >
        <option value="auto">Auto · via Pi</option>
        {models.map((model) => (
          <option key={modelValue(model)} value={modelValue(model)}>
            {model.name} · {model.provider}
          </option>
        ))}
      </select>
      <ChevronIcon className="model-menu__chevron" />
    </label>
  );
}
