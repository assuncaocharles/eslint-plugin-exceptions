import type { Linter } from "eslint";

interface ProcessorMeta {
  name: string;
  version: string;
}

interface Processor {
  meta?: ProcessorMeta;
  preprocess: (
    text: string,
    filename: string
  ) => Array<{ text: string; filename: string }>;
  postprocess: (
    messages: Linter.LintMessage[][],
    filename: string
  ) => Linter.LintMessage[];
  supportsAutofix: boolean;
}

interface PluginMeta {
  name: string;
  version: string;
}

interface Plugin {
  meta: PluginMeta;
  processors: {
    passthrough: Processor;
  };
  configs: {
    recommended: Linter.Config;
  };
}

declare const plugin: Plugin;
export = plugin;
