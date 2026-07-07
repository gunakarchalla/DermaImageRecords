import { Feather } from "@expo/vector-icons";
import { Image } from "expo-image";
import { Linking, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

type Creator = {
  name: string;
  role: string;
  bio: string;
  photo: number;
  linkedInUrl: string;
};

const CREATORS: Creator[] = [
  {
    name: "Nikhil Mehta",
    role: "Co-creator · Clinical lead",
    bio: "The clinical mind behind DermaImageRecords. Nikhil shapes the app around how dermatologists actually work during consultations, making sure every feature earns its place in the exam room.",
    photo: require("../../../assets/images/Nikhil_Photo.png"),
    linkedInUrl: "https://www.linkedin.com/in/nikhil-mehta-349b6079/",
  },
  {
    name: "Gunakar Challa",
    role: "Co-creator · Engineering",
    bio: "The engineer behind DermaImageRecords. Gunakar designs and builds the app end to end — from on-device storage and image handling to the interface you're using right now.",
    photo: require("../../../assets/images/Gunakar_Photo.png"),
    linkedInUrl: "https://www.linkedin.com/in/gunakarchalla/",
  },
];

function CreatorCard({ creator }: { creator: Creator }) {
  return (
    <View className="mb-4 items-center rounded-2xl bg-white p-6 shadow-sm">
      <Image
        source={creator.photo}
        className="h-28 w-28 rounded-full"
        contentFit="cover"
      />
      <Text className="mt-4 text-xl font-bold text-slate-900">
        {creator.name}
      </Text>
      <Text className="mt-1 text-sm font-medium text-slate-500">
        {creator.role}
      </Text>
      <Text className="mt-3 text-center text-base leading-6 text-slate-600">
        {creator.bio}
      </Text>
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={`Open ${creator.name}'s LinkedIn profile`}
        onPress={() => Linking.openURL(creator.linkedInUrl)}
        className="mt-4 flex-row items-center rounded-full bg-[#0A66C2] px-5 py-2.5"
      >
        <Feather name="linkedin" size={18} color="white" />
        <Text className="ml-2 text-base font-semibold text-white">LinkedIn</Text>
      </Pressable>
    </View>
  );
}

export default function CreatorsScreen() {
  return (
    <SafeAreaView className="flex-1 bg-slate-50">
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 48 }}>
        <Text className="mb-4 text-base leading-6 text-slate-600">
          DermaImageRecords is built by two people who wanted a simpler way to
          keep clinical images organized.
        </Text>
        {CREATORS.map((creator) => (
          <CreatorCard key={creator.name} creator={creator} />
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}
