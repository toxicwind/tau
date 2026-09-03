import React, { createContext, useContext, useState, ReactNode } from "react";
import { TabMetadata } from "@oh-my-pi/pi-utils/tabs";

interface TabContextType {
	activeTab: TabMetadata | null;
	setActiveTab: (tab: TabMetadata | null) => void;
	tabs: TabMetadata[];
	setTabs: (tabs: TabMetadata[]) => void;
}

const TabContext = createContext<TabContextType | undefined>(undefined);

export const TabProvider = ({ children }: { children: ReactNode }) => {
	const [activeTab, setActiveTab] = useState<TabMetadata | null>(null);
	const [tabs, setTabs] = useState<TabMetadata[]>([]);

	return (
		<TabContext.Provider value={{ activeTab, setActiveTab, tabs, setTabs }}>
			{children}
		</TabContext.Provider>
	);
};

export const useTabs = () => {
	const context = useContext(TabContext);
	if (!context) {
		throw new Error("useTabs must be used within a TabProvider");
	}
	return context;
};
