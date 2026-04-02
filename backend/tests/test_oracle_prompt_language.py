from babel.prompts import (
    build_chat_prompt,
    build_creative_prompt,
    build_enrichment_prompt,
    build_oracle_prompt,
)


def test_oracle_prompt_prefers_simplified_chinese():
    prompt = build_oracle_prompt(
        world_name="测试世界",
        world_description="一个测试世界。",
        world_lore=["规则一"],
        agents={},
        recent_events=[],
        enriched_details={},
        conversation_history=[],
        user_message="请用中文总结目前的局势。",
        preferred_language="cn",
    )

    assert "Use Simplified Chinese for the reply" in prompt


def test_creative_prompt_prefers_simplified_chinese():
    prompt = build_creative_prompt(
        user_message="一个发生在云海上的市场世界。",
        preferred_language="cn",
    )

    assert "Write all human-readable fields in Simplified Chinese" in prompt


def test_chat_prompt_prefers_simplified_chinese():
    prompt = build_chat_prompt(
        agent_name="黑",
        agent_personality="冷静谨慎",
        agent_goals=["活下去"],
        agent_location="酒吧",
        agent_inventory=["匕首"],
        agent_memory=["他昨晚见过一场交易。"],
        agent_description="一个沉默的中间人。",
        user_message="你现在看到了什么？",
        preferred_language="cn",
    )

    assert "Use Simplified Chinese for the reply" in prompt


def test_enrichment_prompt_prefers_simplified_chinese_from_source_text():
    prompt = build_enrichment_prompt(
        entity_type="item",
        entity_name="旧手枪",
        current_details={},
        relevant_events=["黑把旧手枪塞回了外套里。"],
        world_desc="赛博酒吧的夜晚永远不会结束。",
        preferred_language="",
    )

    assert "Write all human-readable fields in Simplified Chinese" in prompt
