-- Discord panes: Alt+Tab goes through Discord's panes left to right (Alt+Shift+Tab right to
-- left), by where the windows are on screen: nav, channels, user, Discord, then whatever else
-- is on the workspace. Anywhere else it does what Omarchy's Alt+Tab does.
-- install.sh appends this to ~/.config/hypr/bindings.lua if it isn't there yet.
local function discord_panes_tab(forward)
  return function()
    local active = hl.get_active_window()
    if not (active and (active.class == "discord" or active.class == "vesktop")) then
      if forward then -- Omarchy's Alt+Tab
        hl.dispatch(hl.dsp.window.cycle_next())
        hl.dispatch(hl.dsp.window.bring_to_top())
      else
        hl.dispatch(hl.dsp.window.alter_zorder({ mode = "bottom" }))
        hl.dispatch(hl.dsp.window.cycle_next({ next = false }))
      end
      return
    end
    local windows = {}
    for _, w in ipairs(hl.get_workspace_windows(tostring(active.workspace.id))) do
      if w.mapped and not w.hidden then
        table.insert(windows, w)
      end
    end
    table.sort(windows, function(a, b)
      if a.at.x ~= b.at.x then return a.at.x < b.at.x end
      return a.at.y < b.at.y
    end)
    for i, w in ipairs(windows) do
      if w.address == active.address then
        local target = windows[(forward and i or i - 2) % #windows + 1]
        hl.dispatch(hl.dsp.focus({ window = "address:" .. target.address }))
        hl.dispatch(hl.dsp.window.bring_to_top())
        return
      end
    end
  end
end
hl.unbind("ALT + TAB")
hl.unbind("ALT + SHIFT + TAB")
o.bind("ALT + TAB", "Focus on next window (Discord panes: left to right)", discord_panes_tab(true))
o.bind("ALT + SHIFT + TAB", "Focus on previous window (Discord panes: right to left)", discord_panes_tab(false))
