import { Feather, MaterialIcons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";

import { FlashList } from "@shopify/flash-list";

import { PatientListItem } from "../../components/PatientListItem";
import { patientIndexService } from "../../services/indexing/patientIndexService";
import { deletePatient } from "../../services/storage/storage";
import type { Patient } from "../../types/models";

type SortField = "updatedAt" | "createdAt" | "name";
type SortDirection = "asc" | "desc";

const DEFAULT_SORT: { field: SortField; direction: SortDirection } = {
  field: "updatedAt",
  direction: "desc",
};

const PAGE_SIZE = 50;

export default function HomeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [patients, setPatients] = useState<Patient[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [sort, setSort] = useState(DEFAULT_SORT);

  const cursorRef = useRef<{ sortValue: string; id: string } | undefined>(
    undefined,
  );
  const loadSeq = useRef(0);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 250);
    return () => clearTimeout(t);
  }, [search]);

  const loadFirstPage = useCallback(async () => {
    loadSeq.current += 1;
    const seq = loadSeq.current;
    setLoading(true);
    try {
      cursorRef.current = undefined;
      const { items, nextCursor } =
        await patientIndexService.queryPatientsPageAsync({
          limit: PAGE_SIZE,
          search: debouncedSearch,
          sortField: sort.field,
          sortDirection: sort.direction,
        });

      if (seq !== loadSeq.current) return;

      setPatients(items);
      cursorRef.current = nextCursor;
      setHasMore(Boolean(nextCursor));
    } catch (error) {
      Alert.alert(
        "Load failed",
        `Could not load patients. Please try again. Error: ${(error as Error).message}`,
      );
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, sort.field, sort.direction]);

  const loadMore = useCallback(async () => {
    if (loading || loadingMore || !hasMore) return;
    const cursor = cursorRef.current;
    if (!cursor) return;

    loadSeq.current += 1;
    const seq = loadSeq.current;
    setLoadingMore(true);
    try {
      const { items, nextCursor } =
        await patientIndexService.queryPatientsPageAsync({
          limit: PAGE_SIZE,
          search: debouncedSearch,
          sortField: sort.field,
          sortDirection: sort.direction,
          cursor,
        });

      if (seq !== loadSeq.current) return;

      setPatients((prev) => [...prev, ...items]);
      cursorRef.current = nextCursor;
      setHasMore(Boolean(nextCursor));
    } catch {
      // Best-effort paging; ignore transient errors.
    } finally {
      setLoadingMore(false);
    }
  }, [
    debouncedSearch,
    hasMore,
    loading,
    loadingMore,
    sort.field,
    sort.direction,
  ]);

  useFocusEffect(
    useCallback(() => {
      loadFirstPage();
    }, [loadFirstPage]),
  );

  const confirmDelete = useCallback(
    (patient: Patient) => {
      Alert.alert(
        "Delete patient",
        `Delete all records for ${patient.name}? This cannot be undone.`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Delete",
            style: "destructive",
            onPress: async () => {
              try {
                await deletePatient(patient.id);
                await loadFirstPage();
              } catch (error) {
                Alert.alert(
                  "Delete failed",
                  `Could not delete this patient. Error: ${(error as Error).message}`,
                );
              }
            },
          },
        ],
      );
    },
    [loadFirstPage],
  );

  const toggleDirection = () => {
    setSort((prev) => ({
      field: prev.field,
      direction: prev.direction === "asc" ? "desc" : "asc",
    }));
  };

  const setField = (field: SortField) =>
    setSort((prev) => ({ ...prev, field }));

  const renderPatient = useCallback(
    ({ item }: { item: Patient }) => (
      <PatientListItem
        patient={item}
        onPress={(p) => router.push(`/patient/${p.id}`)}
        onDelete={confirmDelete}
      />
    ),
    [confirmDelete, router],
  );

  const fabBottomOffset = Math.max(insets.bottom + 16, 32);
  const listBottomPadding = fabBottomOffset + 72;

  return (
    <SafeAreaView
      edges={["bottom", "left", "right"]}
      className="flex-1 bg-slate-50"
    >
      <View className="px-4 pt-4 pb-2">
        <View className="flex-row items-center bg-white rounded-xl px-3 py-2 shadow-sm">
          <Feather name="search" size={18} color="#475569" />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search by name or EMR"
            className="flex-1 ml-2 text-base"
            placeholderTextColor="#94a3b8"
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>

        <View className="flex-row items-center mt-3">
          <Text className="text-sm text-slate-600 mr-2">Sort:</Text>
          {(
            [
              { label: "Modified", value: "updatedAt" },
              { label: "Created", value: "createdAt" },
              { label: "Name", value: "name" },
            ] as { label: string; value: SortField }[]
          ).map((option) => (
            <Pressable
              key={option.value}
              onPress={() => setField(option.value)}
              className={`px-3 py-1 mr-2 rounded-full border ${
                sort.field === option.value
                  ? "bg-slate-900 border-slate-900"
                  : "border-slate-200"
              }`}
            >
              <Text
                className={`text-xs font-semibold ${
                  sort.field === option.value ? "text-white" : "text-slate-700"
                }`}
              >
                {option.label}
              </Text>
            </Pressable>
          ))}

          <Pressable
            onPress={toggleDirection}
            className="ml-auto px-3 py-1 rounded-full bg-slate-200 flex-row items-center"
          >
            <MaterialIcons
              name={
                sort.direction === "asc" ? "arrow-upward" : "arrow-downward"
              }
              size={16}
              color="#0f172a"
            />
            <Text className="text-xs font-semibold text-slate-800 ml-1">
              {sort.direction === "asc" ? "Asc" : "Desc"}
            </Text>
          </Pressable>
        </View>
      </View>

      {loading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color="#0f172a" />
        </View>
      ) : (
        <FlashList
          data={patients}
          keyExtractor={(item) => item.id}
          renderItem={renderPatient}
          contentContainerStyle={{
            padding: 16,
            paddingBottom: listBottomPadding,
          }}
          onEndReached={loadMore}
          onEndReachedThreshold={0.5}
          ListEmptyComponent={
            <View className="items-center mt-20">
              <Feather name="users" size={32} color="#94a3b8" />
              <Text className="text-slate-500 mt-2">
                No patients yet. Add one to get started.
              </Text>
            </View>
          }
          ListFooterComponent={
            loadingMore ? (
              <View className="py-6">
                <ActivityIndicator size="small" color="#0f172a" />
              </View>
            ) : null
          }
        />
      )}

      <Pressable
        className="absolute right-6 bg-slate-900 h-14 w-14 rounded-full items-center justify-center shadow-lg"
        style={{ bottom: fabBottomOffset }}
        onPress={() => router.push("/patient/add")}
        accessibilityLabel="Add patient"
      >
        <Feather name="plus" size={26} color="white" />
      </Pressable>
    </SafeAreaView>
  );
}
