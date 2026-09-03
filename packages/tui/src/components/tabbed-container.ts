import { Container, Component } from "../tui";
import { TabBar, Tab, TabBarTheme } from "./tab-bar";

/**
 * TabbedContainer manages a set of child components where only one is active at a time,
 * orchestrated by a TabBar.
 */
export class TabbedContainer extends Container {
	private activeTabIndex: number = 0;
	private tabBar: TabBar;
	private children: Component[];

	constructor(title: string, tabs: Tab[], children: Component[], theme: TabBarTheme) {
		super();
		this.tabBar = new TabBar(title, tabs, theme);
		this.children = children;
		
		this.tabBar.onTabChange = (tab: Tab) => {
			this.activeTabIndex = tabs.findIndex(t => t.id === tab.id);
		};
	}

	render() {
		this.tabBar.render();
		if (this.children[this.activeTabIndex]) {
			this.children[this.activeTabIndex].render();
		}
	}
}
