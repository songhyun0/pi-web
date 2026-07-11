import AntGroupColorIcon from "@lobehub/icons/es/AntGroup/components/Color";
import AnthropicIcon from "@lobehub/icons/es/Anthropic/components/Mono";
import AwsColorIcon from "@lobehub/icons/es/Aws/components/Color";
import AzureColorIcon from "@lobehub/icons/es/Azure/components/Color";
import CerebrasColorIcon from "@lobehub/icons/es/Cerebras/components/Color";
import CloudflareColorIcon from "@lobehub/icons/es/Cloudflare/components/Color";
import CohereColorIcon from "@lobehub/icons/es/Cohere/components/Color";
import DeepSeekColorIcon from "@lobehub/icons/es/DeepSeek/components/Color";
import FireworksColorIcon from "@lobehub/icons/es/Fireworks/components/Color";
import GithubCopilotIcon from "@lobehub/icons/es/GithubCopilot/components/Mono";
import GoogleColorIcon from "@lobehub/icons/es/Google/components/Color";
import GrokIcon from "@lobehub/icons/es/Grok/components/Mono";
import GroqIcon from "@lobehub/icons/es/Groq/components/Mono";
import HuggingFaceColorIcon from "@lobehub/icons/es/HuggingFace/components/Color";
import KimiColorIcon from "@lobehub/icons/es/Kimi/components/Color";
import MinimaxColorIcon from "@lobehub/icons/es/Minimax/components/Color";
import MistralColorIcon from "@lobehub/icons/es/Mistral/components/Color";
import MoonshotIcon from "@lobehub/icons/es/Moonshot/components/Mono";
import NvidiaColorIcon from "@lobehub/icons/es/Nvidia/components/Color";
import OpenAIIcon from "@lobehub/icons/es/OpenAI/components/Mono";
import OpenCodeIcon from "@lobehub/icons/es/OpenCode/components/Mono";
import OpenRouterIcon from "@lobehub/icons/es/OpenRouter/components/Mono";
import PerplexityColorIcon from "@lobehub/icons/es/Perplexity/components/Color";
import QwenColorIcon from "@lobehub/icons/es/Qwen/components/Color";
import TogetherColorIcon from "@lobehub/icons/es/Together/components/Color";
import VercelIcon from "@lobehub/icons/es/Vercel/components/Mono";
import XAIIcon from "@lobehub/icons/es/XAI/components/Mono";
import XiaomiMiMoIcon from "@lobehub/icons/es/XiaomiMiMo/components/Mono";
import ZAIIcon from "@lobehub/icons/es/ZAI/components/Mono";
import ZhipuColorIcon from "@lobehub/icons/es/Zhipu/components/Color";
import type { ComponentType } from "react";
import { cx } from "@/components/ui";
import styles from "../ModelsConfig.module.css";

type IconComponent = ComponentType<{ size?: number | string }>;

const PROVIDER_ICONS: Record<string, IconComponent> = {
  anthropic: AnthropicIcon,
  openai: OpenAIIcon,
  "openai-codex": OpenAIIcon,
  google: GoogleColorIcon,
  "google-vertex": GoogleColorIcon,
  "ant-ling": AntGroupColorIcon,
  deepseek: DeepSeekColorIcon,
  groq: GroqIcon,
  mistral: MistralColorIcon,
  moonshotai: MoonshotIcon,
  "moonshotai-cn": MoonshotIcon,
  moonshot: MoonshotIcon,
  minimax: MinimaxColorIcon,
  "minimax-cn": MinimaxColorIcon,
  fireworks: FireworksColorIcon,
  huggingface: HuggingFaceColorIcon,
  cerebras: CerebrasColorIcon,
  openrouter: OpenRouterIcon,
  xai: XAIIcon,
  "cloudflare-ai-gateway": CloudflareColorIcon,
  "cloudflare-workers-ai": CloudflareColorIcon,
  "vercel-ai-gateway": VercelIcon,
  "github-copilot": GithubCopilotIcon,
  "amazon-bedrock": AwsColorIcon,
  "azure-openai-responses": AzureColorIcon,
  "kimi-coding": KimiColorIcon,
  nvidia: NvidiaColorIcon,
  opencode: OpenCodeIcon,
  "opencode-go": OpenCodeIcon,
  qwen: QwenColorIcon,
  xiaomi: XiaomiMiMoIcon,
  "xiaomi-token-plan-ams": XiaomiMiMoIcon,
  "xiaomi-token-plan-cn": XiaomiMiMoIcon,
  "xiaomi-token-plan-sgp": XiaomiMiMoIcon,
  zai: ZAIIcon,
  "zai-coding-cn": ZAIIcon,
  zhipu: ZhipuColorIcon,
  cohere: CohereColorIcon,
  perplexity: PerplexityColorIcon,
  together: TogetherColorIcon,
  grok: GrokIcon,
};

export function ProviderIcon({ id, size = "sm" }: { id: string; size?: "sm" | "md" }) {
  const Icon = PROVIDER_ICONS[id];
  const pixels = size === "md" ? 28 : 18;
  const className = cx(styles.providerIcon, size === "md" ? styles.providerIconMd : styles.providerIconSm);

  if (Icon) {
    return (
      <span className={className} aria-hidden="true">
        <Icon size={pixels} />
      </span>
    );
  }

  const label = id
    .split(/[-_]/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase() || "?";

  return <span className={cx(className, styles.providerInitial)} aria-hidden="true">{label}</span>;
}
