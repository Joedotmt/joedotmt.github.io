let alternateNames = null;

export async function loadAlternateNames() {
  try {
    const response = await fetch("app/altnames.json");
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    alternateNames = await response.json();
    console.log("altnames.json loaded");
  } catch (error) {
    console.error("Failed to load altnames.json:", error);
  }
}

export function getLocalityNames(localityId) {
  if (!alternateNames) return [];

  const locality = alternateNames.find(
    (item) => item.LocalityId === localityId,
  );
  if (!locality) return [];

  return [
    ...new Set(
      locality.Names.split(",")
        .map((name) => name.trim())
        .filter((name) => name.length > 0),
    ),
  ];
}
