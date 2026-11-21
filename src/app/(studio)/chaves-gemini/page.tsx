import { GeminiKeysPage } from '@/components/gemini/GeminiKeysPage';
import { listGeminiKeys } from '@/lib/services/gemini-key-service';

export const dynamic = 'force-dynamic';

export default function GeminiPage() {
  return <GeminiKeysPage initialKeys={listGeminiKeys()} />;
}
