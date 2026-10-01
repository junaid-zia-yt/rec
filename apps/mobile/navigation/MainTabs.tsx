import { createBottomTabNavigator } from '@react-navigation/bottom-tabs'
import { Text } from 'react-native'
import type { MainTabParamList } from './types'
import { HomeStack } from './stacks/HomeStack'
import { ProjectsStack } from './stacks/ProjectsStack'
import { PipelineStack } from './stacks/PipelineStack'
import { ShortlistsStack } from './stacks/ShortlistsStack'
import { MoreStack } from './stacks/MoreStack'
import { colors, layout } from '@/theme/tokens'

const Tab = createBottomTabNavigator<MainTabParamList>()

/** No icon set is finalized yet (docs/04-design-system.md §4.8
 * [UNDETERMINED] — Lucide is only a [RECOMMENDATION] pending client
 * sign-off), so tab icons are a plain text glyph placeholder rather than
 * committing to an icon library ahead of that decision. Swap for real
 * icons once §4.8 is resolved. */
function TabGlyph({ glyph, focused }: { glyph: string; focused: boolean }) {
  return (
    <Text style={{ fontSize: 20, color: focused ? colors.secondary : colors.textInactiveNav }}>
      {glyph}
    </Text>
  )
}

/** §4.15 bottom nav: 56px bar, 5 fixed destinations, active item cobalt. */
export function MainTabs() {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.secondary,
        tabBarInactiveTintColor: colors.textInactiveNav,
        tabBarStyle: { height: layout.bottomNavHeight, backgroundColor: colors.surfaceBase },
      }}
    >
      <Tab.Screen
        name="HomeTab"
        component={HomeStack}
        options={{
          title: 'Home',
          tabBarIcon: ({ focused }) => <TabGlyph glyph="⌂" focused={focused} />,
        }}
      />
      <Tab.Screen
        name="ProjectsTab"
        component={ProjectsStack}
        options={{
          title: 'Projects',
          tabBarIcon: ({ focused }) => <TabGlyph glyph="▤" focused={focused} />,
        }}
      />
      <Tab.Screen
        name="PipelineTab"
        component={PipelineStack}
        options={{
          title: 'Pipeline',
          tabBarIcon: ({ focused }) => <TabGlyph glyph="≡" focused={focused} />,
        }}
      />
      <Tab.Screen
        name="ShortlistsTab"
        component={ShortlistsStack}
        options={{
          title: 'Shortlists',
          tabBarIcon: ({ focused }) => <TabGlyph glyph="✓" focused={focused} />,
        }}
      />
      <Tab.Screen
        name="MoreTab"
        component={MoreStack}
        options={{
          title: 'More',
          tabBarIcon: ({ focused }) => <TabGlyph glyph="•••" focused={focused} />,
        }}
      />
    </Tab.Navigator>
  )
}
