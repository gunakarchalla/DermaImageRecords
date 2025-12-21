import { Feather, MaterialIcons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { deletePatient, listPatients } from "../lib/storage";
import { Patient } from "../types/models";

type SortField = "updatedAt" | "createdAt" | "name";
type SortDirection = "asc" | "desc";

const DEFAULT_SORT: { field: SortField; direction: SortDirection } = {
  field: "updatedAt",
  direction: "desc",
};

export default function HomeScreen() {
  const router = useRouter();
  const [patients, setPatients] = useState<Patient[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState(DEFAULT_SORT);

  const loadPatients = useCallback(async () => {
    setLoading(true);
    try {
      const items = await listPatients();
      setPatients(items);
    } catch (error) {
      Alert.alert(
        "Load failed",
        `Could not load patients. Please try again. Error: ${(error as Error).message}`
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadPatients();
    }, [loadPatients])
  );

  const filteredPatients = useMemo(() => {
    const query = search.trim().toLowerCase();
    const filtered = query
      ? patients.filter(
          (p) =>
            p.name.toLowerCase().includes(query) ||
            (p.emrNumber ?? "").toLowerCase().includes(query)
        )
      : patients;

    const sorted = [...filtered].sort((a, b) => {
      let aVal: string = "";
      let bVal: string = "";

      if (sort.field === "name") {
        aVal = a.name.toLowerCase();
        bVal = b.name.toLowerCase();
      } else if (sort.field === "createdAt") {
        aVal = a.createdAt;
        bVal = b.createdAt;
      } else {
        aVal = a.updatedAt;
        bVal = b.updatedAt;
      }

      if (aVal < bVal) return sort.direction === "asc" ? -1 : 1;
      if (aVal > bVal) return sort.direction === "asc" ? 1 : -1;
      return 0;
    });

    return sorted;
  }, [patients, search, sort]);

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
                await loadPatients();
              } catch (error) {
                Alert.alert(
                  "Delete failed",
                  `Could not delete this patient. Error: ${(error as Error).message}`
                );
              }
            },
          },
        ]
      );
    },
    [loadPatients]
  );

  const toggleDirection = () => {
    setSort((prev) => ({
      field: prev.field,
      direction: prev.direction === "asc" ? "desc" : "asc",
    }));
  };

  const setField = (field: SortField) =>
    setSort((prev) => ({ ...prev, field }));

  const renderPatient = ({ item }: { item: Patient }) => (
    <Pressable
      onPress={() => router.push(`/patient/${item.id}`)}
      className="flex-row items-center bg-white mb-3 rounded-xl p-4 shadow-sm"
    >
      {item.profilePhotoUri ? (
        <Image
          source={{ uri: item.profilePhotoUri }}
          className="h-14 w-14 rounded-full mr-4"
          contentFit="cover"
        />
      ) : (
        <View className="h-14 w-14 rounded-full mr-4 bg-slate-200 items-center justify-center">
          <Feather name="user" size={26} color="#475569" />
        </View>
      )}

      <View className="flex-1">
        <Text className="text-lg font-semibold text-slate-900">
          {item.name}
        </Text>
        {item.emrNumber ? (
          <Text className="text-sm text-slate-500">EMR: {item.emrNumber}</Text>
        ) : null}
        <Text className="text-xs text-slate-400 mt-1">
          Updated {new Date(item.updatedAt).toLocaleString()}
        </Text>
      </View>

      <Pressable
        accessibilityLabel="Delete patient"
        onPress={() => confirmDelete(item)}
        className="p-2"
      >
        <Feather name="trash-2" size={20} color="#e11d48" />
      </Pressable>
    </Pressable>
  );

  return (
    <SafeAreaView className="flex-1 bg-slate-50">
      <View className="px-4 pt-4 pb-2">
        <Text className="text-2xl font-bold text-slate-900 mb-3">Patients</Text>
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
        <FlatList
          data={filteredPatients}
          keyExtractor={(item) => item.id}
          renderItem={renderPatient}
          contentContainerStyle={{ padding: 16, paddingBottom: 96 }}
          ListEmptyComponent={
            <View className="items-center mt-20">
              <Feather name="users" size={32} color="#94a3b8" />
              <Text className="text-slate-500 mt-2">
                No patients yet. Add one to get started.
              </Text>
            </View>
          }
        />
      )}

      <Pressable
        className="absolute bottom-8 right-6 bg-slate-900 h-14 w-14 rounded-full items-center justify-center shadow-lg"
        onPress={() => router.push("/patient/add")}
        accessibilityLabel="Add patient"
      >
        <Feather name="plus" size={26} color="white" />
      </Pressable>
    </SafeAreaView>
  );
}
