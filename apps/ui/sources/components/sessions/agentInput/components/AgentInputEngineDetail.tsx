import * as React from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";

import {
  OptionPickerOverlay,
  type OptionPickerFavoriteOptions,
  type OptionPickerOption,
  type OptionPickerProbeState,
} from "@/components/sessions/pickers/OptionPickerOverlay";
import type {
  SessionConfigOption,
  SessionConfigOptionControl,
  SessionConfigOptionValueId,
} from "@/sync/domains/sessionControl/configOptionsControl";
import { t } from "@/text";
import { useHiddenModelIds } from "@/hooks/models/useHiddenModelIds";
import { findModelOptionForEffectiveModelId } from "@/sync/domains/models/modelOptions";
import { filterVisibleModelOptions } from "@/sync/domains/models/modelVisibility";

import { AgentInputSessionConfigOptionsSection } from "./AgentInputSessionConfigOptionsSection";

type AgentInputEngineModelOption = Readonly<{
  value: string;
  extendedContextModelId?: string;
  label: string;
  icon?: React.ReactNode;
  trailingStatusIcon?: React.ReactNode;
  accessibilityLabel?: string;
  description: string;
  modelOptions?: ReadonlyArray<SessionConfigOption>;
}>;

type AgentInputEngineDetailProps = Readonly<{
  modelOptions?: ReadonlyArray<AgentInputEngineModelOption>;
  backendTargetKey?: string;
  selectedModelId?: string;
  modelSummary?: React.ReactNode;
  modelNotes?: ReadonlyArray<string>;
  modelEmptyText?: string;
  canEnterCustomModel?: boolean;
  modelProbe?: OptionPickerProbeState;
  modelHeaderAccessory?: React.ReactNode;
  favoriteModelValues?: ReadonlySet<string>;
  isModelFavoritable?: (option: AgentInputEngineModelOption) => boolean;
  onToggleFavoriteModel?: (option: AgentInputEngineModelOption) => void;
  onSelectModel?: (value: string) => void;
  onSubmitCustomValue?: (value: string) => void | Promise<void>;
  selectedModelOptionControls?: ReadonlyArray<SessionConfigOptionControl> | null;
  onSelectModelOptionValue?: (
    configId: string,
    valueId: SessionConfigOptionValueId,
  ) => void;

  configControls?: ReadonlyArray<SessionConfigOptionControl> | null;
  configProbe?: OptionPickerProbeState;
  onSelectConfigValue?: (
    configId: string,
    valueId: SessionConfigOptionValueId,
  ) => void;

  sectionOrder?: ReadonlyArray<"model" | "config">;
  surfaceVariant?: "carded" | "plain";
}>;

function wrapSection(
  variant: AgentInputEngineDetailProps["surfaceVariant"],
  key: string,
  content: React.ReactNode,
) {
  if (!content) return null;
  if (variant === "plain") {
    return <React.Fragment key={key}>{content}</React.Fragment>;
  }
  return (
    <View key={key} style={styles.sectionCard}>
      {content}
    </View>
  );
}

function orderFavoriteModelOptionsFirst(
  options: ReadonlyArray<AgentInputEngineModelOption>,
  favoriteValues: ReadonlySet<string> | null | undefined,
): ReadonlyArray<AgentInputEngineModelOption> {
  if (!favoriteValues || favoriteValues.size === 0) return options;

  const favoriteOptions: AgentInputEngineModelOption[] = [];
  const otherOptions: AgentInputEngineModelOption[] = [];
  for (const option of options) {
    if (favoriteValues.has(option.value)) {
      favoriteOptions.push(option);
    } else {
      otherOptions.push(option);
    }
  }

  if (favoriteOptions.length === 0) return options;
  return [...favoriteOptions, ...otherOptions];
}

export function AgentInputEngineDetail(props: AgentInputEngineDetailProps) {
  const hiddenModelIds = useHiddenModelIds(props.backendTargetKey);
  const selectedModelId = props.selectedModelId ?? "default";
  const selectedOption = hiddenModelIds.size > 0 && props.modelOptions
    ? findModelOptionForEffectiveModelId(props.modelOptions, selectedModelId)
    : null;
  const isSelectionHidden = hiddenModelIds.has(selectedModelId)
    || Boolean(selectedOption && hiddenModelIds.has(selectedOption.value));
  const sectionOrder = props.sectionOrder ?? ["model", "config"];
  const surfaceVariant = props.surfaceVariant ?? "carded";
  const hasModelSection =
    (props.modelOptions?.length ?? 0) > 0 || props.canEnterCustomModel === true;
  const hasConfigSection = (props.configControls?.length ?? 0) > 0;

  const resolvedModelOptions = React.useMemo(() => {
    const options = filterVisibleModelOptions(props.modelOptions ?? [], hiddenModelIds);
    const shouldShowDescriptions = options.some(
      (option) =>
        option.value !== "default" &&
        typeof option.description === "string" &&
        option.description.trim().length > 0,
    );

    const describedOptions = shouldShowDescriptions ? options.map((option) => {
      if (option.value !== "default") return option;
      if (typeof option.description === "string" && option.description.trim().length > 0) {
        return option;
      }
      return { ...option, description: t("agentInput.model.configureInCli") };
    }) : options;

    return orderFavoriteModelOptionsFirst(describedOptions, props.favoriteModelValues);
  }, [hiddenModelIds, props.favoriteModelValues, props.modelOptions]);

  const favoriteOptions = React.useMemo<OptionPickerFavoriteOptions | undefined>(() => {
    if (!props.onToggleFavoriteModel || !props.favoriteModelValues) {
      return undefined;
    }

    return {
      values: props.favoriteModelValues,
      isFavoritable: props.isModelFavoritable
        ? (option: OptionPickerOption) => props.isModelFavoritable?.(option as AgentInputEngineModelOption) === true
        : undefined,
      onToggle: (option: OptionPickerOption) => {
        props.onToggleFavoriteModel?.(option as AgentInputEngineModelOption);
      },
    };
  }, [
    props.favoriteModelValues,
    props.isModelFavoritable,
    props.onToggleFavoriteModel,
  ]);

  // This probe merges agent detection with the model, mode and config probes, so its refresh
  // control is named for everything it rescans rather than models alone.
  const modelProbe = React.useMemo<OptionPickerProbeState | undefined>(() => (
    props.modelProbe && !props.modelProbe.refreshAccessibilityLabel
      ? { ...props.modelProbe, refreshAccessibilityLabel: t("modelPickerOverlay.refreshEngineA11y") }
      : props.modelProbe
  ), [props.modelProbe]);

  if (!hasModelSection && !hasConfigSection) {
    return null;
  }

  const sections: Record<"model" | "config", React.ReactNode | null> =
    {
      model: hasModelSection
        ? wrapSection(
            surfaceVariant,
            "model",
            <OptionPickerOverlay
              title={t("agentInput.model.title")}
              summary={props.modelSummary}
              notes={[
                ...(isSelectionHidden ? [t("modelVisibility.currentModel", { model: selectedOption?.label ?? selectedModelId })] : []),
                ...(props.modelNotes ?? []),
                ...(props.modelProbe?.error ? [t("errors.unknownError")] : []),
              ]}
              options={resolvedModelOptions}
              selectedValue={selectedModelId}
              selectedValueHidden={isSelectionHidden}
              emptyText={
                props.modelEmptyText ?? t("agentInput.model.configureInCli")
              }
              canEnterCustomValue={props.canEnterCustomModel === true}
              customLabel={`${t("profiles.custom")}...`}
              customDescription={t("agentInput.model.customDescription")}
              favoriteOptions={favoriteOptions}
              headerAccessory={props.modelHeaderAccessory}
              probe={modelProbe}
              selectedOptionControls={props.selectedModelOptionControls ?? undefined}
              onSelectOptionControlValue={props.onSelectModelOptionValue}
              onSelect={props.onSelectModel ?? (() => {})}
              onSubmitCustomValue={props.onSubmitCustomValue}
            />,
          )
        : null,
      config: hasConfigSection
        ? wrapSection(
            surfaceVariant,
            "config",
            <View style={styles.configSection}>
              <AgentInputSessionConfigOptionsSection
                controls={props.configControls ?? []}
                onSelectValue={props.onSelectConfigValue}
              />
            </View>,
          )
        : null,
    };

  return (
    <View style={styles.container}>
      {sectionOrder.map((sectionId) => sections[sectionId])}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    gap: 10,
  },
  sectionCard: {
    overflow: "hidden",
  },
  configSection: {
    gap: 8,
  },
}));
