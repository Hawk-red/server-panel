import { useLayout } from '@/context/layout-provider'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuItem,
  SidebarRail,
  SidebarSeparator,
} from '@/components/ui/sidebar'
import { PanelRestartButton, RebootButton } from '@/features/system/reboot'
import { AppTitle } from './app-title'
import { sidebarData } from './data/sidebar-data'
import { NavGroup } from './nav-group'
import { NavUser } from './nav-user'

export function AppSidebar() {
  const { collapsible, variant } = useLayout()
  return (
    <Sidebar collapsible={collapsible} variant={variant}>
      <SidebarHeader>
        <AppTitle />
      </SidebarHeader>
      <SidebarContent>
        {sidebarData.navGroups.map((props) => (
          <NavGroup key={props.title} {...props} />
        ))}
      </SidebarContent>
      <SidebarFooter>
        <NavUser />
        {/* Опасное действие — отдельным пунктом в самом низу, отделено линией и красным цветом */}
        <SidebarSeparator />
        {/* Сверху — лёгкий перезапуск панели (нейтральный), ниже — опасная перезагрузка сервера (красная) */}
        <SidebarMenu>
          <SidebarMenuItem>
            <PanelRestartButton />
          </SidebarMenuItem>
          <SidebarMenuItem>
            <RebootButton />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
