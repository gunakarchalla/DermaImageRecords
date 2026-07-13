import { SafeAreaView } from "react-native-safe-area-context";

import { EmptyState } from "../../../components/ui/EmptyState";

/**
 * Placeholder: the photo feed arrives with the data-model update, which adds the photos
 * index this grid pages over.
 */
export default function GalleryScreen() {
  return (
    <SafeAreaView
      edges={["bottom", "left", "right"]}
      className="flex-1 bg-slate-50 dark:bg-slate-950"
    >
      <EmptyState
        icon="image"
        title="Gallery"
        message="Every photo you take will be browsable here, newest first. Coming with the next update."
      />
    </SafeAreaView>
  );
}
