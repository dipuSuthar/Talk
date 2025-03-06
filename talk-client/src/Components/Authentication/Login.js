import React, { useState } from "react";
import {
  Button,
  FormControl,
  FormLabel,
  IconButton,
  Input,
  InputGroup,
  InputRightElement,
} from "@chakra-ui/react";
import axios from "axios";
import { ViewIcon, ViewOffIcon } from "@chakra-ui/icons";

const Login = () => {
  const [Email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setshowPassword] = useState(false);
  const HandleLogin = async () => {
    try {
      const data = {
        email: Email,
        password: password,
      };

      const path = "http://localhost:8000/api/user/login";

      const headers = {
        "Content-Type": "application/json",
      };

      const response = await axios.post(path, data, { headers });
      if (response) {
        localStorage.setItem("userInfo", JSON.stringify(response.data));
        window.location.href = "/chats";
      }
      console.log(response.data);
    } catch (error) {
      // Handle errors here
      console.error("There was an error with the login request", error);
    }
  };
  return (
    <>
      <FormControl id="email" isRequired>
        <FormLabel>Email</FormLabel>
        <Input
          type="email"
          placeholder="Enter Your Email"
          onChange={(e) => setEmail(e.target.value)}
        />
      </FormControl>
      <FormControl id="password" isRequired>
        <FormLabel>Password</FormLabel>
        <InputGroup>
          <Input
            type={!showPassword ? "password" : "text"}
            placeholder="Enter Your Password"
            onChange={(e) => setPassword(e.target.value.trim())}
          />
          <InputRightElement>
            {showPassword ? (
              <IconButton onClick={() => setshowPassword(!showPassword)}>
                <ViewOffIcon />
              </IconButton>
            ) : (
              <IconButton onClick={() => setshowPassword(!showPassword)}>
                <ViewIcon />
              </IconButton>
            )}
          </InputRightElement>
        </InputGroup>
      </FormControl>
      <Button
        m={2}
        width="100%"
        isLoading={false}
        loadingText="Submitting"
        backgroundColor="#bee3f8"
        variant="solid"
        onClick={HandleLogin}
      >
        Submit
      </Button>
      <Button
        m={2}
        width="100%"
        isLoading={false}
        loadingText="Submitting"
        backgroundColor="red"
        variant="solid"
      >
        Get Guest User Credentials
      </Button>
    </>
  );
};

export default Login;
