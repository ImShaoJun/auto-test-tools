Feature: 用户创建接口测试

  Background:
    * url 'http://localhost:8080'
    * configure headers = { 'Cookie': '#(cookie)' }

  Scenario: 成功创建用户
    Given path '/api/user/create'
    And request 
    """
    {
      "username": "test_user_001",
      "email": "test@example.com",
      "role": "ADMIN"
    }
    """
    When method post
    Then status 200
    
    # 基础断言
    * match response.code == 0
    * match response.data.userId == '#number'
    
    # 动态获取刚创建的 ID 并保存为变量，可供后续接口使用
    * def newUserId = response.data.userId

  Scenario: 创建用户 - 缺少必填字段
    Given path '/api/user/create'
    And request 
    """
    {
      "email": "test@example.com"
    }
    """
    When method post
    Then status 200
    
    # 预期失败状态码
    * match response.code == 400
    * match response.message contains 'username'
